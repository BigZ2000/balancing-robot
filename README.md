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
│       │   └── StatusBar.jsx      # Statut robot temps réel
│       ├── hooks/
│       │   ├── useLipSync.js      # Synchronisation lèvres/son
│       │   └── useRobotWS.js      # WebSocket robot
│       └── App.jsx
├── backend/           # FastAPI — API WebSocket + contrôle robot
│   ├── main.py
│   └── requirements.txt
└── hardware/          # (Sprint 3) Code Raspberry Pi + moteurs
```

## Sprints Agile

### Sprint 1 ✅ — Masque Animé (Frontend)
- SVG masque africain animé avec Framer Motion
- 6 émotions : Neutre, Joie, Colère, Tristesse, Surprise, Parole
- Lip-sync via Web Speech API + animation phonèmes
- Mode plein écran pour l'écran du robot
- Dashboard de contrôle

### Sprint 2 🔄 — Backend & TTS
- API FastAPI + WebSocket temps réel
- Simulation télémétrie robot
- TTS amélioré avec timing précis

### Sprint 3 📋 — Intégration Raspberry Pi
- Code équilibre (PID controller)
- Pilotage moteurs hoverboard (ODrive/VESC)
- Déploiement sur Pi avec autostart
- IMU (accéléromètre/gyroscope) pour équilibre

## Lancement

### Frontend
```bash
cd frontend
npm install
npm run dev
# → http://localhost:3000
```

### Backend
```bash
cd backend
pip install -r requirements.txt
python main.py
# → http://localhost:5000
```

## Hardware (Sprint 3)

- Raspberry Pi 4 (8GB recommandé)
- Écran officiel Pi 7" ou HDMI
- Roues hoverboard 6.5" ou 8.5"
- Contrôleurs moteurs : ODrive ou VESC
- IMU : MPU-6050 ou BNO055
- Batterie LiPo 36V (hoverboard)
- Régulateur 5V pour le Pi
