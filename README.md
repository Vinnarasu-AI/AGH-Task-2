# HireIQ — Live Conversational 3D AI Interviewer

HireIQ is a full-stack, real-time conversational AI interviewer pipeline. It features an interactive 3D VRM human avatar with natural seated interviewer postures and conversational hand gestures, powered by local speech-to-text, local LLM intelligence, and high-speed neural text-to-speech.

---

## 🌟 Key Features

- **Realistic 3D VRM Avatar (`@pixiv/three-vrm` + Three.js):**
  - **Calibrated Seated Rest Pose:** Natural office posture with lowered, relaxed shoulders, forearms resting forward on an executive desk surface, and relaxed hand and finger curves (no splayed or floating arms).
  - **Discrete Conversational Hand Gestures:** Context-aware subtle emphasis, explanatory, and acknowledgment gestures during speaking that smoothly blend and return to the stable rest baseline.
  - **Real-Time Lip-Sync:** Dynamic viseme mapping (`aa`, `ih`, `ou`, `ee`, `oh`) synchronized with audio playback and RMS energy analysis.
  - **Attentive Behaviors:** Micro-movements, breathing cycles, saccadic eye gaze shifts, and natural blinking during IDLE, LISTENING, THINKING, and SPEAKING states.
  - **Modern Office Setting:** Warm executive office background with an integrated foreground desk surface, framed waist-up in a professional video call composition.

- **High-Performance Speech-to-Text:**
  - **Faster-Whisper (CUDA accelerated):** Low-latency transcription of candidate audio recorded directly from the browser microphone.

- **Conversational Intelligence:**
  - **Ollama (Llama 3):** Prompt-engineered for friendly, professional, and natural conversational dialogue.

- **Real-Time Neural Voice (TTS):**
  - **Kokoro-82M:** High-quality, fast local text-to-speech engine (`af_bella` voice).

---

## 🏗️ Architecture & Pipeline

```text
[ Browser Mic ] ──> [ Faster-Whisper (CUDA) ] ──> [ Ollama (Llama 3) ] ──> [ Kokoro-82M TTS ]
                                                                                   │
                                                                                   ▼
[ 3D Seated Avatar ] <── [ Audio Visemes & Gestures ] <── [ Audio Stream & Visemes ]
```

---

## 📁 Repository Structure

```text
AGH-Task-2/
├── backend/
│   ├── main.py              # FastAPI server (STT, LLM, TTS, & Viseme pipeline)
│   └── static/
│       └── .gitkeep         # Audio runtime cache directory
├── frontend/
│   ├── public/
│   │   ├── avatars/
│   │   │   └── rocketbox-business-female-01.vrm  # Realistic 3D business avatar
│   │   └── office_background.jpg                 # Modern executive office environment
│   ├── src/
│   │   ├── AIInterviewerAvatar.tsx  # 3D VRM Three.js seated pose & gesture controller
│   │   ├── App.jsx                  # Main interface, audio recording, & state machine
│   │   ├── App.css                  # Modern UI styles
│   │   ├── soundEffects.js          # Web Audio feedback chimes
│   │   └── AvatarErrorBoundary.jsx  # Fallback handling for WebGL / VRM
│   ├── package.json
│   ├── tsconfig.json
│   └── vite.config.js
├── run_app.bat              # One-click startup script for both backend & frontend
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

1. **Python 3.10+ with CUDA support** (NVIDIA GPU recommended)
2. **Node.js 18+ and npm**
3. **Ollama** running locally with `llama3`:
   ```bash
   ollama run llama3
   ```

### Quick Start (Windows)

Simply double-click or run:
```cmd
run_app.bat
```
This automatically starts the FastAPI backend at `http://127.0.0.1:8000` and the Vite frontend at `http://127.0.0.1:5173`.

### Manual Setup

#### 1. Backend Setup
```bash
python -m venv venv
.\venv\Scripts\activate
pip install fastapi uvicorn faster-whisper kokoro-onnx soundfile numpy requests
python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

#### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 📄 License
MIT License.
