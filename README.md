# African Mask Balancing Robot

Robot balançant sur roues de overboard avec un visage masque africain animé sur écran Raspberry Pi.

## Architecture

```
balancing-robot/
├── frontend/          # React + Vite — Interface masque animé
│   └── src/
│       ├── components/
│       │   ├── AfricanMask.jsx    # SVG animé du masque
│       │   ├── EmotionPanel.jsx   # Sélecteur d'émotions
│       │   ├── SpeechPanel.jsx    # Contrôle parole / lip-sync
│       │   ├── AudioViz.jsx       # Visualiseur audio canvas
│       │   ├── BalanceViz.jsx     # PID + pendule graphique
│       │   ├── RobotControl.jsx   # Joystick + clavier
│       │   └── StatusBar.jsx      # Statut robot temps réel
│       ├── hooks/
│       │   ├── useLipSync.js      # Web Speech API + lip-sync
│       │   ├── useBackendTTS.js   # edge-tts backend
│       │   ├── useRobotWS.js      # WebSocket robot
│       │   └── useTextEmotion.js  # Détection émotion auto
│       └── App.jsx
├── backend/           # FastAPI — API WebSocket + contrôle robot
│   ├── main.py        # Auto-détection hardware vs simulation
│   ├── tts_engine.py  # edge-tts (fr-FR-DeniseNeural)
│   ├── pid_sim.py     # Simulation PID (mode PC)
│   └── requirements.txt
├── hardware/          # Couche hardware Raspberry Pi
│   ├── config.py      # Configuration (IMU, moteurs, PID, sécurité)
│   ├── imu.py         # MPU-6050 / BNO055 / simulé
│   ├── motors.py      # VESC / ODrive / simulé
│   ├── balance_loop.py # Boucle PID 100Hz hardware
│   └── requirements.txt
└── deploy/            # Déploiement Raspberry Pi
    ├── setup.sh       # Script d'installation complet
    ├── nginx.conf     # Reverse proxy frontend + API
    ├── robot-backend.service   # systemd FastAPI
    └── robot-frontend.service  # systemd nginx (fallback)
```

## Sprints Agile

### Sprint 1 ✅ — Masque Animé (Frontend)
- SVG masque africain animé avec Framer Motion
- 6 émotions : Neutre, Joie, Colère, Tristesse, Surprise, Parole
- Lip-sync via Web Speech API + animation phonèmes
- Mode plein écran pour l'écran du robot
- Dashboard de contrôle

### Sprint 2 ✅ — Backend TTS + PID + Animations
- TTS edge-tts (fr-FR-DeniseNeural) avec timing phonèmes précis
- Simulation PID pendule inversé à 50Hz
- Blink animé naturel avec jitter
- Visualiseur audio canvas 8 barres
- Détection automatique d'émotion (200+ mots-clés FR/EN)
- Joystick tactile + contrôle clavier WASD

### Sprint 3 ✅ — Intégration Raspberry Pi
- IMU MPU-6050 via I²C + filtre complémentaire (α=0.98)
- Support BNO055 (fusion intégrée, aucun filtre nécessaire)
- Moteurs VESC via UART/pyvesc + CAN forwarding moteur droit
- Moteurs ODrive via USB (contrôle vitesse en tours/s)
- Boucle PID 100Hz avec coupure sécurité (|angle| > 30°)
- Détection automatique hardware → fallback simulation transparent
- Badge "🤖 Hardware Pi" dans le dashboard
- Script setup.sh complet (I2C, systemd, nginx, kiosk Chromium)
- Services systemd autostart au démarrage

## Lancement

### Développement (PC)

```bash
# Frontend
cd frontend && npm install && npm run dev
# → http://localhost:3000

# Backend (simulation automatique sans hardware)
cd backend && pip install -r requirements.txt
python main.py
# → http://localhost:5000
```

### Déploiement Raspberry Pi

```bash
# Cloner le repo sur le Pi
git clone https://github.com/BigZ2000/balancing-robot /home/pi/balancing-robot

# Script d'installation complet (root requis)
sudo bash /home/pi/balancing-robot/deploy/setup.sh

# Redémarrer pour activer I2C/SPI
sudo reboot
# → Interface sur http://<IP-du-Pi>
```

### Configuration hardware

Éditer `/etc/systemd/system/robot-backend.service` puis redémarrer :

```bash
sudo systemctl edit robot-backend
# Ajouter dans [Service] :
#   Environment=ROBOT_IMU=mpu6050
#   Environment=ROBOT_MOTORS=vesc
#   Environment=ROBOT_VESC_PORT=/dev/ttyACM0
sudo systemctl daemon-reload && sudo systemctl restart robot-backend
```

Ou créer `hardware/config.json` :
```json
{
  "imu_type": "mpu6050",
  "motor_type": "vesc",
  "vesc_port": "/dev/ttyACM0",
  "kp": 28.0,
  "ki": 0.8,
  "kd": 4.5,
  "max_angle": 30.0,
  "loop_hz": 100
}
```

## Hardware

| Composant | Modèle recommandé |
|-----------|-------------------|
| Ordinateur | Raspberry Pi 4 (4GB+) |
| Écran | Pi Official 7" ou HDMI |
| Roues | Hoverboard 6.5" ou 8.5" |
| Contrôleur moteur | VESC 6 MkVI ou ODrive v3.6 |
| IMU | MPU-6050 (I²C addr 0x68) |
| Batterie | LiPo 36V hoverboard |
| Régulateur | 5V 5A (pour le Pi) |

## Câblage MPU-6050

```
MPU-6050  →  Raspberry Pi 4
VCC       →  Pin 1  (3.3V)
GND       →  Pin 6  (GND)
SCL       →  Pin 5  (GPIO 3 / SCL)
SDA       →  Pin 3  (GPIO 2 / SDA)
AD0       →  GND    (adresse I²C = 0x68)
```

Vérifier la détection : `i2cdetect -y 1` → doit afficher `68`.

## Tuning PID

Les valeurs par défaut (Kp=28, Ki=0.8, Kd=4.5) sont calibrées pour simulation.
Sur le vrai robot, ajuster via le dashboard (onglet "Équilibre") :
- Augmenter **Kp** si le robot ne se redresse pas assez vite
- Augmenter **Kd** pour amortir les oscillations
- Augmenter **Ki** (prudemment) pour corriger le biais statique
