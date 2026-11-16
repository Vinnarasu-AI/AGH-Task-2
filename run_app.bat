@echo off
title Live Human AI Avatar Application
color 0b

echo =================================================================
echo           LIVE HUMAN AI AVATAR APPLICATION (OLLAMA + MUSETALK)
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
start "Avatar Backend Server (FastAPI + CUDA)" cmd /k ".\venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

:: Wait for GPU models to initialize
echo [*] Initializing Faster-Whisper, Kokoro TTS, and MuseTalk on GPU...
echo [*] Waiting 10 seconds for backend models to load...
timeout /t 10 >nul

:: 3. Launch React Frontend
echo [*] Starting React Frontend on http://127.0.0.1:5173 ...
start "Avatar Frontend UI (React + Vite)" cmd /k "cd frontend && npm run dev -- --host 127.0.0.1 --port 5173"

:: 4. Open Application in Default Browser
timeout /t 3 >nul
start http://127.0.0.1:5173

echo.
echo =================================================================
echo [+] Application launched successfully!
echo.
echo     Frontend App: http://127.0.0.1:5173
echo     Backend API:  http://127.0.0.1:8000/api/health
echo =================================================================
pause
