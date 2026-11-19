import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
import sys
import uuid
import time
import json
import subprocess
import requests
import re
import numpy as np
import soundfile as sf
import torch
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATIC_DIR = os.path.join(BASE_DIR, "backend", "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Add FFmpeg to PATH if available in WinGet location
ffmpeg_dir = r"C:\Users\rvinn\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin"
if os.path.exists(ffmpeg_dir):
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

# Add PyTorch CUDA dlls for ctranslate2
torch_lib = os.path.join(os.path.dirname(torch.__file__), "lib")
if hasattr(os, "add_dll_directory") and os.path.exists(torch_lib):
    os.add_dll_directory(torch_lib)
os.environ["PATH"] = torch_lib + os.pathsep + os.environ.get("PATH", "")

from faster_whisper import WhisperModel
from kokoro import KPipeline

app = FastAPI(title="AI Conversational Avatar Pipeline")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Model singletons
whisper_stt = None
kokoro_pipeline = None

@app.on_event("startup")
def load_all_services():
    global whisper_stt, kokoro_pipeline

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] Initializing Conversational Pipeline on device: {device}")

    # 1. Faster-Whisper
    print("[*] Loading Faster-Whisper small.en (High-Accuracy STT)...")
    whisper_stt = WhisperModel("small.en", device=device, compute_type="float16")
    print("[+] Faster-Whisper small.en loaded.")

    # 2. Kokoro TTS
    print("[*] Loading Kokoro-82M TTS...")
    kokoro_pipeline = KPipeline(lang_code="a")
    print("[+] Kokoro TTS loaded.")
    print(f"[+] All AI models ready! VRAM allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")


class AskTextRequest(BaseModel):
    text: str


def query_ollama(prompt: str) -> str:
    url = "http://localhost:11434/api/generate"
    system_prompt = (
        "You are a friendly, intelligent, and natural conversational AI assistant (like ChatGPT and Gemini). "
        "Answer the user conversationally, warmly, and helpfully in 1 or 2 spoken sentences (under 35 words). "
        "If the user says hi, hello, or introduces themselves, greet them warmly and answer naturally. "
        "Do not act like a harsh interviewer. Speak in natural conversational English. "
        "Never use markdown, asterisks, bullet points, or emojis."
    )
    payload = {
        "model": "llama3",
        "prompt": f"{system_prompt}\n\nUser: {prompt}\nAI Assistant:",
        "stream": False,
        "options": {
            "num_predict": 50,
            "temperature": 0.7
        }
    }
    try:
        res = requests.post(url, json=payload, timeout=15)
        res.raise_for_status()
        ans = res.json().get("response", "").strip()
        # Clean formatting
        ans = re.sub(r'[*_#`~]', '', ans).strip()
        sentences = [s.strip() for s in re.split(r'(?<=[.!?]) +', ans) if s.strip()]
        return " ".join(sentences[:2]) if sentences else ans
    except Exception as e:
        print(f"[!] Ollama error: {e}")
        return "Hello! I am doing great and happy to chat with you. How can I help you today?"


def generate_speech(text: str, out_wav_path: str):
    generator = kokoro_pipeline(text, voice="af_bella", speed=1.12)
    audio_segments = []
    for gs, ps, audio in generator:
        if isinstance(audio, torch.Tensor):
            audio = audio.cpu().numpy()
        audio_segments.append(audio)

    if not audio_segments:
        raise ValueError("Kokoro TTS produced no audio.")

    full_audio = np.concatenate(audio_segments)
    sf.write(out_wav_path, full_audio, 24000)
    return out_wav_path


@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "models": {
            "stt": "Faster-Whisper (CUDA)",
            "brain": "Ollama llama3",
            "tts": "Kokoro-82M",
            "avatar": "3D VRM Rocketbox Avatar"
        }
    }


@app.post("/api/ask-audio")
async def ask_audio(audio: UploadFile = File(...)):
    session_id = uuid.uuid4().hex[:8]
    raw_upload_path = os.path.join(STATIC_DIR, f"upload_{session_id}_{audio.filename or 'audio.webm'}")
    input_wav_path = os.path.join(STATIC_DIR, f"input_{session_id}.wav")
    reply_wav_path = os.path.join(STATIC_DIR, f"reply_{session_id}.wav")

    content = await audio.read()
    print(f"[*] Received user voice upload: {len(content)} bytes")
    if len(content) < 1000:
        raise HTTPException(status_code=400, detail="Recording too short or empty. Please speak clearly into your mic.")

    with open(raw_upload_path, "wb") as f:
        f.write(content)

    # Convert uploaded webm/wav/mp4 to standard 16kHz mono 16-bit WAV using ffmpeg
    try:
        subprocess.run(
            f'ffmpeg -y -i "{raw_upload_path}" -vn -ar 16000 -ac 1 -c:a pcm_s16le "{input_wav_path}"',
            shell=True,
            check=True,
            capture_output=True
        )
    except Exception as conv_err:
        print(f"[!] Audio conversion error: {conv_err}")
        input_wav_path = raw_upload_path

    # Check audio energy / RMS to ensure real sound was captured
    try:
        data, sr = sf.read(input_wav_path)
        rms = float(np.sqrt(np.mean(data**2)))
        print(f"[*] Converted audio duration: {len(data)/sr:.2f}s, RMS energy: {rms:.6f}")
        if rms < 0.001:
            raise HTTPException(
                status_code=400,
                detail="Microphone captured pure silence. Please check your browser microphone input and speak aloud."
            )
    except HTTPException:
        raise
    except Exception as e:
        print(f"[*] RMS check bypassed: {e}")

    # 1. Faster-Whisper Speech Recognition with language forced to English
    segments, info = whisper_stt.transcribe(
        input_wav_path,
        language="en",
        beam_size=5,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=300, speech_pad_ms=200),
        temperature=0.0,
        condition_on_previous_text=False
    )
    transcription = " ".join([seg.text.strip() for seg in segments]).strip()
    print(f"[STT User Question]: '{transcription}'")

    # If VAD filtered too aggressively, retry once with raw audio
    if not transcription:
        segments, _ = whisper_stt.transcribe(
            input_wav_path,
            language="en",
            beam_size=5,
            vad_filter=False,
            condition_on_previous_text=False
        )
        transcription = " ".join([seg.text.strip() for seg in segments]).strip()
        print(f"[STT User Question (retry)]: '{transcription}'")

    # Filter out common Whisper silence hallucination tokens
    hallucinations = ["you", "you.", "thank you", "thank you.", "subtitles by", "bye.", "bye"]
    if transcription.lower().strip() in hallucinations:
        print(f"[!] Filtered hallucination '{transcription}'")
        raise HTTPException(
            status_code=400,
            detail="Could not detect clear speech. Please speak closer to your microphone."
        )

    if not transcription or len(transcription) < 2:
        raise HTTPException(
            status_code=400,
            detail="Could not clearly hear speech. Please speak closer to your microphone."
        )

    # 2. Ollama Conversational Brain
    ai_response = query_ollama(transcription)
    print(f"[LLM Response]: {ai_response}")

    # 3. Kokoro TTS
    generate_speech(ai_response, reply_wav_path)
    print(f"[TTS Audio generated]: {reply_wav_path}")

    audio_url = f"http://localhost:8000/static/{os.path.basename(reply_wav_path)}"

    # Clean up input audio
    try:
        if os.path.exists(raw_upload_path):
            os.remove(raw_upload_path)
        if os.path.exists(input_wav_path):
            os.remove(input_wav_path)
    except:
        pass

    return {
        "user_text": transcription,
        "ai_text": ai_response,
        "audio_url": audio_url
    }


@app.post("/api/ask-text")
def ask_text(req: AskTextRequest):
    session_id = uuid.uuid4().hex[:8]
    reply_wav_path = os.path.join(STATIC_DIR, f"reply_{session_id}.wav")

    user_text = req.text.strip()
    print(f"[Text Question]: '{user_text}'")
    ai_response = query_ollama(user_text)
    print(f"[LLM Response]: {ai_response}")
    generate_speech(ai_response, reply_wav_path)

    audio_url = f"http://localhost:8000/static/{os.path.basename(reply_wav_path)}"

    return {
        "user_text": user_text,
        "ai_text": ai_response,
        "audio_url": audio_url
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
