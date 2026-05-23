/**
 * African Mask Robot — Firmware Teensy 4.1
 *
 * Rôles :
 *  - Lecture IMU MPU-6050 via I2C (200Hz)
 *  - PID balance (100Hz) → contrôleurs RIoRand (PWM servo pulse)
 *  - Servo bras 60KG avec engrenages opposés (mouvement lent + expressif)
 *  - Communication JSON USB série avec Raspberry Pi (115200 baud)
 *  - Sécurité : coupure si |angle| > 35° ou watchdog 500ms
 *
 * Bibliothèques requises (Teensyduino Library Manager) :
 *  - I2Cdev + MPU6050 (jrowberg)
 *  - ArduinoJSON 7.x
 *  - Servo (inclus Teensyduino)
 */

#include <Arduino.h>
#include <Wire.h>
#include <Servo.h>
#include <ArduinoJson.h>
#include "I2Cdev.h"
#include "MPU6050.h"

// ── Pins ──────────────────────────────────────────────────────────────────────
// RIoRand : signal servo-pulse (1000–2000 µs) sur les broches PWM Teensy
#define MOTOR_LEFT_PWM   2    // moteur gauche
#define MOTOR_RIGHT_PWM  3    // moteur droit
#define SERVO_ARM_PIN    6    // servo bras 60KG

// ── Paramètres physiques ──────────────────────────────────────────────────────
#define LOOP_HZ          100   // boucle PID
#define IMU_HZ           200   // lecture IMU
#define WATCHDOG_MS      500   // timeout commande Pi
#define MAX_ANGLE        35.0f // coupure sécurité (°)
#define MOTOR_NEUTRAL    1500  // µs arrêt (contrôleurs RIoRand)
#define MOTOR_MAX_FWD    1900  // µs plein avant
#define MOTOR_MAX_BWD    1100  // µs plein arrière
#define ARM_NEUTRAL      1500  // µs bras centré
#define ARM_MIN          600   // µs bras bas
#define ARM_MAX          2400  // µs bras haut

// ── PID par défaut ────────────────────────────────────────────────────────────
float Kp = 25.0f, Ki = 0.5f, Kd = 8.0f;
float pid_setpoint = 0.0f;

// ── IMU ───────────────────────────────────────────────────────────────────────
MPU6050 imu;
int16_t ax, ay, az, gx, gy, gz;
float angle_filtered = 0.0f;
float gyro_rate      = 0.0f;
float gyro_offset    = 0.0f;
const float CF_ALPHA = 0.98f;

// ── Moteurs ───────────────────────────────────────────────────────────────────
Servo motorLeft, motorRight, servoBras;

// ── État ──────────────────────────────────────────────────────────────────────
float pid_integral   = 0.0f;
float pid_last_err   = 0.0f;
float target_speed   = 0.0f;   // -100..100
float target_turn    = 0.0f;   // -100..100
float arm_target_pct = 0.0f;   // -100..100
float arm_current    = 0.0f;   // position réelle (lissée)
bool  safety_stop    = false;
float battery_pct    = 100.0f;

unsigned long last_cmd_ms = 0;
unsigned long last_pid_ms = 0;
unsigned long last_imu_ms = 0;
unsigned long last_telem_ms = 0;

// ── Fonctions utilitaires ─────────────────────────────────────────────────────

float clamp(float v, float lo, float hi) {
  return v < lo ? lo : (v > hi ? hi : v);
}

// Convertit pourcentage (-100..100) en µs servo-pulse
int pctToUs(float pct, int neutral, int max_fwd, int max_bwd) {
  if (pct >= 0)
    return neutral + (int)((pct / 100.0f) * (max_fwd - neutral));
  else
    return neutral + (int)((pct / 100.0f) * (neutral - max_bwd));
}

// ── Calibration gyroscope ─────────────────────────────────────────────────────

void calibrateGyro(int n = 300) {
  double sum = 0;
  for (int i = 0; i < n; i++) {
    imu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);
    sum += gy;
    delay(2);
  }
  gyro_offset = sum / n;
}

// ── Lecture IMU + filtre complémentaire ───────────────────────────────────────

void updateIMU(float dt) {
  imu.getMotion6(&ax, &ay, &az, &gx, &gy, &gz);

  // Gyroscope Y → vitesse angulaire (°/s)
  float gy_dps = (gy - gyro_offset) / 131.0f;
  gyro_rate = gy_dps;

  // Accéléromètre → angle pitch (°)
  float ax_g = ax / 16384.0f;
  float ay_g = ay / 16384.0f;
  float az_g = az / 16384.0f;
  float accel_angle = atan2f(ax_g, sqrtf(ay_g*ay_g + az_g*az_g)) * 180.0f / PI;

  // Filtre complémentaire
  angle_filtered = CF_ALPHA * (angle_filtered + gy_dps * dt)
                 + (1.0f - CF_ALPHA) * accel_angle;
}

// ── PID ───────────────────────────────────────────────────────────────────────

float computePID(float measured, float dt) {
  float error = pid_setpoint - measured;
  pid_integral = clamp(pid_integral + error * dt, -50.0f, 50.0f);
  float d_error = (error - pid_last_err) / dt;
  pid_last_err  = error;
  return clamp(Kp * error + Ki * pid_integral + Kd * d_error, -100.0f, 100.0f);
}

// ── Moteurs ───────────────────────────────────────────────────────────────────

void setMotors(float left_pct, float right_pct) {
  motorLeft.writeMicroseconds(pctToUs(left_pct,  MOTOR_NEUTRAL, MOTOR_MAX_FWD, MOTOR_MAX_BWD));
  motorRight.writeMicroseconds(pctToUs(right_pct, MOTOR_NEUTRAL, MOTOR_MAX_FWD, MOTOR_MAX_BWD));
}

void stopMotors() {
  motorLeft.writeMicroseconds(MOTOR_NEUTRAL);
  motorRight.writeMicroseconds(MOTOR_NEUTRAL);
}

// ── Bras (lent + expressif) ───────────────────────────────────────────────────

void updateArm(float dt) {
  // Lerp lent vers la cible (vitesse ~30%/s max)
  float step = 30.0f * dt;
  if (arm_current < arm_target_pct - step) arm_current += step;
  else if (arm_current > arm_target_pct + step) arm_current -= step;
  else arm_current = arm_target_pct;

  servoBras.writeMicroseconds(pctToUs(arm_current, ARM_NEUTRAL, ARM_MAX, ARM_MIN));
}

// ── Télémétrie JSON → Pi ──────────────────────────────────────────────────────

void sendTelemetry() {
  JsonDocument doc;
  doc["t"]     = "telem";
  doc["angle"] = roundf(angle_filtered * 100) / 100.0f;
  doc["gyro"]  = roundf(gyro_rate * 10) / 10.0f;
  doc["bat"]   = roundf(battery_pct * 10) / 10.0f;
  doc["arm"]   = roundf(arm_current);
  doc["safe"]  = !safety_stop;
  doc["spd"]   = target_speed;
  serializeJson(doc, Serial);
  Serial.println();
}

// ── Parsing commandes Pi → JSON ───────────────────────────────────────────────

void parseCommand(const String& line) {
  JsonDocument doc;
  if (deserializeJson(doc, line) != DeserializationError::Ok) return;

  const char* cmd = doc["cmd"];
  if (!cmd) return;

  last_cmd_ms = millis();

  if (strcmp(cmd, "drive") == 0) {
    target_speed = clamp((float)doc["speed"] | 0, -100.0f, 100.0f);
    target_turn  = clamp((float)doc["turn"]  | 0, -100.0f, 100.0f);
    // Setpoint : avancer = s'incliner en avant
    pid_setpoint = target_speed * 0.025f;
  }
  else if (strcmp(cmd, "arm") == 0) {
    arm_target_pct = clamp((float)doc["pos"] | 0, -100.0f, 100.0f);
  }
  else if (strcmp(cmd, "pid") == 0) {
    if (doc.containsKey("kp")) Kp = (float)doc["kp"];
    if (doc.containsKey("ki")) Ki = (float)doc["ki"];
    if (doc.containsKey("kd")) Kd = (float)doc["kd"];
    pid_integral = 0;
    pid_last_err = 0;
  }
  else if (strcmp(cmd, "stop") == 0) {
    target_speed = 0;
    target_turn  = 0;
    pid_setpoint = 0;
    pid_integral = 0;
    safety_stop  = false;
  }
}

// ── Setup ─────────────────────────────────────────────────────────────────────

void setup() {
  Serial.begin(115200);
  while (!Serial && millis() < 3000) {}

  // I2C + IMU
  Wire.begin();
  Wire.setClock(400000);  // 400kHz Fast Mode
  imu.initialize();
  if (!imu.testConnection()) {
    Serial.println("{\"error\":\"MPU6050 non détecté\"}");
  }
  calibrateGyro();

  // Moteurs
  motorLeft.attach(MOTOR_LEFT_PWM);
  motorRight.attach(MOTOR_RIGHT_PWM);
  stopMotors();

  // Servo bras
  servoBras.attach(SERVO_ARM_PIN, ARM_MIN, ARM_MAX);
  servoBras.writeMicroseconds(ARM_NEUTRAL);

  last_cmd_ms   = millis();
  last_pid_ms   = millis();
  last_imu_ms   = millis();
  last_telem_ms = millis();

  // Prêt
  JsonDocument info;
  info["t"] = "ready";
  info["kp"] = Kp; info["ki"] = Ki; info["kd"] = Kd;
  serializeJson(info, Serial);
  Serial.println();
}

// ── Loop ──────────────────────────────────────────────────────────────────────

void loop() {
  unsigned long now = millis();
  float dt_pid = (now - last_pid_ms) / 1000.0f;
  float dt_imu = (now - last_imu_ms) / 1000.0f;

  // ── Lecture série ──────────────────────────────────────────────────────────
  if (Serial.available()) {
    String line = Serial.readStringUntil('\n');
    line.trim();
    if (line.length() > 2) parseCommand(line);
  }

  // ── IMU @200Hz ─────────────────────────────────────────────────────────────
  if (dt_imu >= 1.0f / IMU_HZ) {
    updateIMU(dt_imu);
    last_imu_ms = now;
  }

  // ── PID + Moteurs @100Hz ───────────────────────────────────────────────────
  if (dt_pid >= 1.0f / LOOP_HZ) {
    last_pid_ms = now;

    // Watchdog : pas de commande depuis > WATCHDOG_MS → arrêt
    bool watchdog = (now - last_cmd_ms) > WATCHDOG_MS;

    // Sécurité angle
    if (fabsf(angle_filtered) > MAX_ANGLE) {
      safety_stop = true;
    }

    if (safety_stop || watchdog) {
      stopMotors();
      if (watchdog && target_speed != 0) {
        target_speed = 0; target_turn = 0; pid_setpoint = 0; pid_integral = 0;
      }
    } else {
      float motor_out = computePID(angle_filtered, dt_pid);
      float left  = motor_out + target_turn * 0.35f;
      float right = motor_out - target_turn * 0.35f;
      setMotors(clamp(left, -100, 100), clamp(right, -100, 100));
    }

    // Bras
    updateArm(dt_pid);

    // Simulation batterie (à remplacer par lecture ADC)
    battery_pct = max(0.0f, battery_pct - fabsf(target_speed) * 0.0001f);
  }

  // ── Télémétrie @20Hz ──────────────────────────────────────────────────────
  if (now - last_telem_ms >= 50) {
    sendTelemetry();
    last_telem_ms = now;
  }

  // Reset sécurité si robot remis à plat
  if (safety_stop && fabsf(angle_filtered) < 10.0f) {
    safety_stop  = false;
    pid_integral = 0;
  }
}
