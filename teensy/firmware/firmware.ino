/*
 * firmware.ino — African Mask Balancing Robot
 * Teensy 4.1
 *
 * Hardware
 *   MPU-6050  IMU        — I2C (Wire), I2Cdevlib/MPU6050
 *   RIoRand hoverboard motor controllers
 *       Left  motor : PWM servo-pulse on pins 2 (fwd) and 3 (rev)
 *       Right motor : PWM servo-pulse on pins 4 (fwd) and 5 (rev)
 *       Pulse range  : 1000 µs (stop/reverse) → 1500 µs (neutral) → 2000 µs (fwd)
 *   60 kg·cm servo arm — Servo library on pin 6 (500–2500 µs)
 *   Battery ADC        — voltage divider on A0 (10k + 3.3k → 0-14 V range)
 *   USB Serial (Serial) at 115200 baud — JSON protocol with Raspberry Pi
 *
 * JSON input  (Pi → Teensy, newline-terminated)
 *   {"cmd":"drive","speed":50,"turn":20}       — speed/turn -100…+100
 *   {"cmd":"arm","pos":30}                     — arm position -100…+100
 *   {"cmd":"pid","kp":25.0,"ki":0.5,"kd":8.0} — retune PID gains live
 *   {"cmd":"stop"}                             — emergency stop
 *   {"cmd":"calibrate"}                        — re-run gyro calibration
 *
 * JSON output (Teensy → Pi)
 *   {"t":"telem","angle":1.2,"gyro":0.3,"bat":95.2,"arm":45,"fault":0}
 *   {"t":"ready","kp":25.0,"ki":0.5,"kd":8.0}  — on boot
 *   {"t":"ack","cmd":"pid"}                     — on PID retune
 *
 * Loop rates
 *   IMU read + complementary filter : 200 Hz  (5 ms)
 *   PID + motor output              : 100 Hz  (10 ms)
 *   Arm lerp                        : 100 Hz  (10 ms)
 *   Telemetry publish               : 100 Hz  (10 ms)
 *   Serial parse                    : every loop iteration (non-blocking)
 *
 * Safety
 *   |angle| > 35°       → motors cut immediately; auto-reset when < 10°
 *   No "drive" cmd in >500 ms → watchdog: speed/turn forced to 0
 *   Both conditions log fault:1 in telemetry
 *
 * Libraries required (install via Arduino Library Manager)
 *   I2Cdevlib-MPU6050  (jrowberg/i2cdevlib) — I2Cdev.h + MPU6050.h
 *   ArduinoJson        (bblanchon/ArduinoJson) v6 or v7
 *   Servo              (included with Teensyduino)
 */

// ---------------------------------------------------------------------------
// Includes
// ---------------------------------------------------------------------------
#include <Arduino.h>
#include <Wire.h>
#include <Servo.h>
#include <ArduinoJson.h>
#include "I2Cdev.h"
#include "MPU6050.h"

// ---------------------------------------------------------------------------
// Pin definitions
// ---------------------------------------------------------------------------
//  RIoRand hoverboard controller — each side has a forward and reverse signal.
//  Sending 1500 µs = neutral/stop, 2000 µs = full speed on that wire.
//  We energise only the active direction wire; the other stays at neutral.
#define PIN_MOTOR_L_FWD   2    // Left  motor forward  (servo-pulse)
#define PIN_MOTOR_L_REV   3    // Left  motor reverse  (servo-pulse)
#define PIN_MOTOR_R_FWD   4    // Right motor forward  (servo-pulse)
#define PIN_MOTOR_R_REV   5    // Right motor reverse  (servo-pulse)

#define PIN_ARM_SERVO     6    // 60 kg·cm servo arm
#define PIN_BATTERY_ADC   A0   // Voltage divider: 10k + 3.3k → measures 0–14 V
#define PIN_LED           13   // Onboard LED (heartbeat)

// ---------------------------------------------------------------------------
// Motor PWM constants (µs)
// ---------------------------------------------------------------------------
#define PWM_NEUTRAL  1500    // controller stop / centre
#define PWM_FULL     2000    // full speed on the active direction wire
#define PWM_MIN      1000    // minimum valid pulse

// ---------------------------------------------------------------------------
// Arm servo constants (µs) — wider range for 60 kg digital servo
// ---------------------------------------------------------------------------
#define ARM_PULSE_MIN   500   // full negative (-100 %)
#define ARM_PULSE_CTR  1500   // centre (0 %)
#define ARM_PULSE_MAX  2500   // full positive (+100 %)

// ---------------------------------------------------------------------------
// Safety thresholds
// ---------------------------------------------------------------------------
#define MAX_SAFE_ANGLE   35.0f   // degrees — cut motors beyond this tilt
#define AUTO_RESET_ANGLE 10.0f   // degrees — re-enable motors when recovered
#define WATCHDOG_MS       500    // ms without a "drive" command → force stop

// ---------------------------------------------------------------------------
// IMU / filter constants
// ---------------------------------------------------------------------------
#define CF_ALPHA         0.98f   // complementary filter weight (gyro vs accel)
#define CALIB_SAMPLES      500   // gyro calibration sample count
#define LSB_PER_DPS      131.0f  // MPU-6050 ±250 dps mode
#define LSB_PER_G      16384.0f  // MPU-6050 ±2 g mode

// ---------------------------------------------------------------------------
// Loop timing
// ---------------------------------------------------------------------------
#define IMU_INTERVAL_US    5000  // 200 Hz
#define PID_INTERVAL_MS      10  // 100 Hz
#define TELEM_INTERVAL_MS    10  // 100 Hz
#define LED_INTERVAL_MS     500  // 1 Hz blink

// ---------------------------------------------------------------------------
// PID defaults
// ---------------------------------------------------------------------------
#define PID_KP_DEFAULT   25.0f
#define PID_KI_DEFAULT    0.5f
#define PID_KD_DEFAULT    8.0f
#define PID_I_CLAMP      50.0f  // anti-windup
#define PID_OUT_CLAMP   100.0f

// ---------------------------------------------------------------------------
// Arm lerp
// ---------------------------------------------------------------------------
// Max arm velocity: 100 % / s at 100 Hz = 1 %/tick full speed
// ARM_LERP_RATE of 0.08 → time constant ≈ 125 ms for expressive movement
#define ARM_LERP_RATE    0.08f

// ---------------------------------------------------------------------------
// Battery ADC
// ---------------------------------------------------------------------------
// Divider: Vbat —[10kΩ]— A0 —[3.3kΩ]— GND
// Vbat_max at A0 = Vbat * 3.3 / (10 + 3.3) = Vbat * 0.248
// At 3.3 V Teensy Vref: A0_full = 3.3 V → Vbat_full = 3.3 / 0.248 ≈ 13.3 V
// ADC scale factor: Vbat = ADC_raw / 1023.0 * 3.3 / 0.248
#define BAT_ADC_SCALE    (3.3f / 1023.0f / 0.2481f)
#define BAT_FULL_V       12.6f   // 3S LiPo full
#define BAT_EMPTY_V       9.0f   // 3S LiPo empty

// ---------------------------------------------------------------------------
// Servo objects
// ---------------------------------------------------------------------------
Servo motorLFwd, motorLRev;   // Left  motor direction wires
Servo motorRFwd, motorRRev;   // Right motor direction wires
Servo armServo;               // 60 kg·cm arm servo

// ---------------------------------------------------------------------------
// IMU
// ---------------------------------------------------------------------------
MPU6050 imu;
int16_t rawAx, rawAy, rawAz, rawGx, rawGy, rawGz;

float angleFiltered = 0.0f;  // pitch angle, degrees (+ve = forward lean)
float gyroRateDps   = 0.0f;  // angular velocity, degrees/s
float gyroBias      = 0.0f;  // gyro Y-axis offset (calibrated at startup)

// ---------------------------------------------------------------------------
// PID
// ---------------------------------------------------------------------------
float pidKp        = PID_KP_DEFAULT;
float pidKi        = PID_KI_DEFAULT;
float pidKd        = PID_KD_DEFAULT;
float pidSetpoint  = 0.0f;
float pidIntegral  = 0.0f;
float pidErrPrev   = 0.0f;
float pidOutput    = 0.0f;

// ---------------------------------------------------------------------------
// Drive command (received from Pi)
// ---------------------------------------------------------------------------
float cmdSpeed = 0.0f;   // -100 … +100  (+ve = forward)
float cmdTurn  = 0.0f;   // -100 … +100  (+ve = right)

// ---------------------------------------------------------------------------
// Arm
// ---------------------------------------------------------------------------
float armTarget  = 0.0f;   // commanded position, -100 … +100
float armCurrent = 0.0f;   // smoothed current position

// ---------------------------------------------------------------------------
// State flags
// ---------------------------------------------------------------------------
bool faulted    = false;   // tilt safety cut
bool motorsPowered = false;

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------
uint32_t lastImuUs     = 0;
uint32_t lastPidMs     = 0;
uint32_t lastTelemMs   = 0;
uint32_t lastDriveCmdMs = 0;  // watchdog timer
uint32_t lastLedMs     = 0;
bool ledState          = false;

// ---------------------------------------------------------------------------
// Serial line buffer
// ---------------------------------------------------------------------------
#define LINE_BUF_SIZE 256
char lineBuf[LINE_BUF_SIZE];
uint8_t lineBufIdx = 0;

// ---------------------------------------------------------------------------
// Forward declarations
// ---------------------------------------------------------------------------
void imuInit();
void calibrateGyro();
void updateIMU(float dtS);
void pidReset();
float computePID(float measured, float setpoint, float dtS);
void setMotors(float leftPct, float rightPct);
void stopMotors();
uint16_t pctToPwm(float pct);        // 0…100 → PWM_NEUTRAL…PWM_FULL
uint16_t armPosToUs(float pos);      // -100…+100 → ARM_PULSE_MIN…ARM_PULSE_MAX
void updateArm(float dtS);
float readBatteryPct();
void parseSerial();
void handleJson(const char* buf);
void sendTelemetry();
void sendJson(JsonDocument& doc);


// ===========================================================================
// SETUP
// ===========================================================================
void setup() {
    pinMode(PIN_LED, OUTPUT);
    digitalWrite(PIN_LED, HIGH);  // on during init

    Serial.begin(115200);
    // Wait up to 2 s for USB host — skip if not connected (standalone mode)
    uint32_t t0 = millis();
    while (!Serial && (millis() - t0) < 2000) {}

    // ── I2C / IMU ────────────────────────────────────────────────────────────
    Wire.begin();
    Wire.setClock(400000);  // 400 kHz fast mode

    imuInit();
    calibrateGyro();

    // ── Motors ───────────────────────────────────────────────────────────────
    // Attach with explicit pulse range so Servo library never sends out-of-range
    motorLFwd.attach(PIN_MOTOR_L_FWD, PWM_MIN, PWM_FULL);
    motorLRev.attach(PIN_MOTOR_L_REV, PWM_MIN, PWM_FULL);
    motorRFwd.attach(PIN_MOTOR_R_FWD, PWM_MIN, PWM_FULL);
    motorRRev.attach(PIN_MOTOR_R_REV, PWM_MIN, PWM_FULL);
    stopMotors();

    // ── Arm servo ────────────────────────────────────────────────────────────
    armServo.attach(PIN_ARM_SERVO, ARM_PULSE_MIN, ARM_PULSE_MAX);
    armServo.writeMicroseconds(ARM_PULSE_CTR);  // centre on boot

    // ── Init timing ──────────────────────────────────────────────────────────
    uint32_t now = millis();
    lastPidMs      = now;
    lastTelemMs    = now;
    lastDriveCmdMs = now;
    lastLedMs      = now;
    lastImuUs      = micros();

    motorsPowered = true;
    digitalWrite(PIN_LED, LOW);

    // ── Boot message ─────────────────────────────────────────────────────────
    StaticJsonDocument<128> boot;
    boot["t"]  = "ready";
    boot["kp"] = pidKp;
    boot["ki"] = pidKi;
    boot["kd"] = pidKd;
    sendJson(boot);
}


// ===========================================================================
// MAIN LOOP
// ===========================================================================
void loop() {
    uint32_t nowUs = micros();
    uint32_t nowMs = millis();

    // ── 200 Hz IMU update ────────────────────────────────────────────────────
    if ((uint32_t)(nowUs - lastImuUs) >= IMU_INTERVAL_US) {
        float dtS   = (float)(nowUs - lastImuUs) * 1e-6f;
        lastImuUs   = nowUs;
        updateIMU(dtS);
    }

    // ── Non-blocking serial parse ─────────────────────────────────────────────
    parseSerial();

    // ── 100 Hz PID + motor update ─────────────────────────────────────────────
    if ((uint32_t)(nowMs - lastPidMs) >= PID_INTERVAL_MS) {
        float dtS  = (float)(nowMs - lastPidMs) * 1e-3f;
        lastPidMs  = nowMs;

        // Watchdog: no drive command for >500 ms → zero speed/turn
        if ((uint32_t)(nowMs - lastDriveCmdMs) > WATCHDOG_MS) {
            cmdSpeed = 0.0f;
            cmdTurn  = 0.0f;
        }

        // Safety: tilt cut
        if (!faulted && fabsf(angleFiltered) > MAX_SAFE_ANGLE) {
            faulted = true;
            stopMotors();
        }
        // Auto-reset when robot recovers to near-upright
        if (faulted && fabsf(angleFiltered) < AUTO_RESET_ANGLE) {
            faulted = false;
            pidReset();
        }

        if (!faulted && motorsPowered) {
            // Lean setpoint: positive speed = lean forward slightly
            pidSetpoint = cmdSpeed * 0.08f;   // 100 % speed = 8° setpoint shift

            pidOutput = computePID(angleFiltered, pidSetpoint, dtS);

            // Motor mix: PID drives both wheels; turn adds differential
            float leftPct  =  pidOutput + cmdTurn * 0.35f;
            float rightPct = -pidOutput + cmdTurn * 0.35f;

            // Clamp to ±100
            leftPct  = constrain(leftPct,  -100.0f, 100.0f);
            rightPct = constrain(rightPct, -100.0f, 100.0f);

            setMotors(leftPct, rightPct);
        }

        // Arm lerp update
        updateArm(dtS);
    }

    // ── 100 Hz telemetry output ───────────────────────────────────────────────
    if ((uint32_t)(nowMs - lastTelemMs) >= TELEM_INTERVAL_MS) {
        lastTelemMs = nowMs;
        sendTelemetry();
    }

    // ── LED heartbeat (1 Hz) ──────────────────────────────────────────────────
    if ((uint32_t)(nowMs - lastLedMs) >= LED_INTERVAL_MS) {
        lastLedMs = nowMs;
        ledState  = !ledState;
        digitalWrite(PIN_LED, ledState);
    }
}


// ===========================================================================
// IMU
// ===========================================================================
void imuInit() {
    imu.initialize();
    if (!imu.testConnection()) {
        // Fast blink loop — IMU not found, cannot balance
        while (true) {
            digitalWrite(PIN_LED, !digitalRead(PIN_LED));
            delay(80);
        }
    }
    // Configure for maximum sensitivity
    imu.setFullScaleAccelRange(MPU6050_ACCEL_FS_2);   // ±2 g
    imu.setFullScaleGyroRange(MPU6050_GYRO_FS_250);   // ±250 °/s
    imu.setDLPFMode(MPU6050_DLPF_BW_42);              // 42 Hz low-pass filter
}

void calibrateGyro() {
    // Flash LED during calibration (robot must be perfectly still)
    long sum = 0;
    for (int i = 0; i < CALIB_SAMPLES; i++) {
        imu.getMotion6(&rawAx, &rawAy, &rawAz, &rawGx, &rawGy, &rawGz);
        sum += rawGy;   // pitch axis
        delay(2);
        if (i % 50 == 0) digitalWrite(PIN_LED, !digitalRead(PIN_LED));
    }
    gyroBias = (float)sum / (float)CALIB_SAMPLES;
    digitalWrite(PIN_LED, LOW);
}

void updateIMU(float dtS) {
    imu.getMotion6(&rawAx, &rawAy, &rawAz, &rawGx, &rawGy, &rawGz);

    // Gyro pitch rate (°/s), bias-corrected
    gyroRateDps = ((float)rawGy - gyroBias) / LSB_PER_DPS;

    // Accel pitch angle via atan2 (robust against roll)
    float ax_g = (float)rawAx / LSB_PER_G;
    float ay_g = (float)rawAy / LSB_PER_G;
    float az_g = (float)rawAz / LSB_PER_G;
    float accelAngle = atan2f(ax_g, sqrtf(ay_g * ay_g + az_g * az_g))
                       * (180.0f / (float)M_PI);

    // Complementary filter: trust gyro short-term, accel long-term
    angleFiltered = CF_ALPHA * (angleFiltered + gyroRateDps * dtS)
                  + (1.0f - CF_ALPHA) * accelAngle;
}


// ===========================================================================
// PID
// ===========================================================================
void pidReset() {
    pidIntegral = 0.0f;
    pidErrPrev  = 0.0f;
    pidOutput   = 0.0f;
}

float computePID(float measured, float setpoint, float dtS) {
    float err = setpoint - measured;

    // Integral with anti-windup clamp
    pidIntegral = constrain(pidIntegral + err * dtS,
                            -PID_I_CLAMP, PID_I_CLAMP);

    // Derivative on measurement to avoid derivative kick on setpoint steps
    float deriv = (err - pidErrPrev) / max(dtS, 1e-6f);
    pidErrPrev  = err;

    float out = pidKp * err + pidKi * pidIntegral + pidKd * deriv;
    return constrain(out, -PID_OUT_CLAMP, PID_OUT_CLAMP);
}


// ===========================================================================
// Motors
// ===========================================================================
/*
 * RIoRand wiring pattern:
 *   Each motor controller has two PWM inputs: FWD and REV.
 *   - FWD energised (>1500 µs) and REV at neutral → motor runs forward
 *   - REV energised (>1500 µs) and FWD at neutral → motor runs reverse
 *   - Both at 1500 µs → motor stops (brake or coast depending on controller DIP)
 *
 * setMotors(left, right): left/right in -100…+100
 */
uint16_t pctToPwm(float pct) {
    // pct: 0…100 → PWM_NEUTRAL…PWM_FULL
    float clamped = constrain(pct, 0.0f, 100.0f);
    return (uint16_t)(PWM_NEUTRAL + (clamped / 100.0f) * (float)(PWM_FULL - PWM_NEUTRAL));
}

void setMotors(float leftPct, float rightPct) {
    // Left motor
    if (leftPct >= 0.0f) {
        motorLFwd.writeMicroseconds(pctToPwm(leftPct));
        motorLRev.writeMicroseconds(PWM_NEUTRAL);
    } else {
        motorLFwd.writeMicroseconds(PWM_NEUTRAL);
        motorLRev.writeMicroseconds(pctToPwm(-leftPct));
    }

    // Right motor (physically reversed on robot frame, so negate)
    float rp = -rightPct;
    if (rp >= 0.0f) {
        motorRFwd.writeMicroseconds(pctToPwm(rp));
        motorRRev.writeMicroseconds(PWM_NEUTRAL);
    } else {
        motorRFwd.writeMicroseconds(PWM_NEUTRAL);
        motorRRev.writeMicroseconds(pctToPwm(-rp));
    }
}

void stopMotors() {
    motorLFwd.writeMicroseconds(PWM_NEUTRAL);
    motorLRev.writeMicroseconds(PWM_NEUTRAL);
    motorRFwd.writeMicroseconds(PWM_NEUTRAL);
    motorRRev.writeMicroseconds(PWM_NEUTRAL);
}


// ===========================================================================
// Arm
// ===========================================================================
uint16_t armPosToUs(float pos) {
    // pos: -100…+100 → ARM_PULSE_MIN…ARM_PULSE_MAX
    float t = (constrain(pos, -100.0f, 100.0f) + 100.0f) / 200.0f;  // 0…1
    return (uint16_t)(ARM_PULSE_MIN + t * (float)(ARM_PULSE_MAX - ARM_PULSE_MIN));
}

void updateArm(float dtS) {
    float delta = armTarget - armCurrent;
    if (fabsf(delta) > 0.1f) {
        // Lerp: fraction of remaining distance per tick → smooth S-curve feel
        armCurrent += delta * ARM_LERP_RATE;
    } else {
        armCurrent = armTarget;
    }
    armCurrent = constrain(armCurrent, -100.0f, 100.0f);
    armServo.writeMicroseconds(armPosToUs(armCurrent));
}


// ===========================================================================
// Battery
// ===========================================================================
float readBatteryPct() {
    int   raw     = analogRead(PIN_BATTERY_ADC);
    float voltage = (float)raw * BAT_ADC_SCALE;
    float pct     = (voltage - BAT_EMPTY_V) / (BAT_FULL_V - BAT_EMPTY_V) * 100.0f;
    return constrain(pct, 0.0f, 100.0f);
}


// ===========================================================================
// Serial JSON protocol
// ===========================================================================
void parseSerial() {
    while (Serial.available()) {
        char c = (char)Serial.read();

        if (c == '\n' || c == '\r') {
            if (lineBufIdx > 0) {
                lineBuf[lineBufIdx] = '\0';
                handleJson(lineBuf);
                lineBufIdx = 0;
            }
        } else {
            if (lineBufIdx < LINE_BUF_SIZE - 1) {
                lineBuf[lineBufIdx++] = c;
            } else {
                // Overflow — discard and restart
                lineBufIdx = 0;
            }
        }
    }
}

void handleJson(const char* buf) {
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, buf) != DeserializationError::Ok) return;

    const char* cmd = doc["cmd"];
    if (!cmd) return;

    if (strcmp(cmd, "drive") == 0) {
        cmdSpeed = constrain((float)doc["speed"], -100.0f, 100.0f);
        cmdTurn  = constrain((float)doc["turn"],  -100.0f, 100.0f);
        lastDriveCmdMs = millis();   // reset watchdog

    } else if (strcmp(cmd, "arm") == 0) {
        armTarget = constrain((float)doc["pos"], -100.0f, 100.0f);

    } else if (strcmp(cmd, "pid") == 0) {
        if (doc.containsKey("kp")) pidKp = (float)doc["kp"];
        if (doc.containsKey("ki")) pidKi = (float)doc["ki"];
        if (doc.containsKey("kd")) pidKd = (float)doc["kd"];
        pidReset();
        StaticJsonDocument<64> ack;
        ack["t"]   = "ack";
        ack["cmd"] = "pid";
        ack["kp"]  = pidKp;
        ack["ki"]  = pidKi;
        ack["kd"]  = pidKd;
        sendJson(ack);

    } else if (strcmp(cmd, "stop") == 0) {
        cmdSpeed = 0.0f;
        cmdTurn  = 0.0f;
        faulted  = false;
        pidReset();
        stopMotors();
        lastDriveCmdMs = millis();

    } else if (strcmp(cmd, "calibrate") == 0) {
        stopMotors();
        cmdSpeed = 0.0f;
        cmdTurn  = 0.0f;
        calibrateGyro();
        pidReset();
        StaticJsonDocument<64> ack;
        ack["t"]   = "ack";
        ack["cmd"] = "calibrate";
        sendJson(ack);
    }
}

void sendTelemetry() {
    // Use snprintf for zero-heap, deterministic output
    char buf[128];
    snprintf(buf, sizeof(buf),
        "{\"t\":\"telem\","
        "\"angle\":%.2f,"
        "\"gyro\":%.2f,"
        "\"bat\":%.1f,"
        "\"arm\":%.1f,"
        "\"fault\":%d}",
        angleFiltered,
        gyroRateDps,
        readBatteryPct(),
        armCurrent,
        (int)faulted
    );
    Serial.println(buf);
}

void sendJson(JsonDocument& doc) {
    serializeJson(doc, Serial);
    Serial.println();
}
