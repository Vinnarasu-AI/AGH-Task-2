@echo off
title HireIQ — Conversational AI Avatar Application
color 0b

echo =================================================================
echo         HIREIQ — CONVERSATIONAL AI AVATAR APPLICATION
echo         Faster-Whisper (CUDA) + Ollama + Kokoro + 3D VRM
echo =================================================================
echo.

cd /d "%~dp0"

:: 1. Ensure Ollama is running
echo [*] Checking Ollama service...
ollama list >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Starting Ollama server in background...
    start "Ollama Service" /min ollama serve
    timeout /t 3 >nul
)
echo [+] Ollama is ready.

:: 2. Launch FastAPI Backend
echo [*] Starting FastAPI Backend on http://127.0.0.1:8000 ...
start "HireIQ Backend Server (FastAPI + CUDA)" cmd /k ".\venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

:: Wait for STT & TTS models to initialize
echo [*] Initializing Faster-Whisper and Kokoro TTS on GPU...
timeout /t 3 >nul

:: 3. Launch React Frontend
echo [*] Starting React Frontend on http://127.0.0.1:5173 ...
start "HireIQ Frontend UI (React + Vite)" cmd /k "cd frontend && npm run dev -- --host 127.0.0.1 --port 5173"

:: 4. Open Application in Default Browser
timeout /t 2 >nul
start http://127.0.0.1:5173

echo.
echo =================================================================
echo [+] Application launched successfully!
echo.
echo     Frontend App: http://127.0.0.1:5173
echo     Backend API:  http://127.0.0.1:8000/api/health
echo =================================================================
pause
