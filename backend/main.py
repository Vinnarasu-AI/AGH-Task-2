import os
import sys
import uuid
import time
import json
import pickle
import subprocess
import requests
import re
import numpy as np
import cv2
import soundfile as sf
import torch
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Base paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSETALK_DIR = os.path.join(BASE_DIR, "musetalk_repo")
STATIC_DIR = os.path.join(BASE_DIR, "backend", "static")
os.makedirs(STATIC_DIR, exist_ok=True)

# Add FFmpeg to PATH
ffmpeg_dir = r"C:\Users\rvinn\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin"
if os.path.exists(ffmpeg_dir):
    os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")

# Add PyTorch CUDA dlls for ctranslate2
torch_lib = os.path.join(os.path.dirname(torch.__file__), "lib")
if hasattr(os, "add_dll_directory") and os.path.exists(torch_lib):
    os.add_dll_directory(torch_lib)
os.environ["PATH"] = torch_lib + os.pathsep + os.environ.get("PATH", "")

# Patch torch.load weights_only=False and map_location='cpu' for PyTorch 2.6
_orig_load = torch.load
torch.load = lambda *args, **kwargs: _orig_load(*args, **{**kwargs, "weights_only": False, "map_location": "cpu"})

# Add musetalk to sys.path
if MUSETALK_DIR not in sys.path:
    sys.path.insert(0, MUSETALK_DIR)

from faster_whisper import WhisperModel
from kokoro import KPipeline
from diffusers import AutoencoderKL
from musetalk.models.unet import UNet, PositionalEncoding
from musetalk.utils.audio_processor import AudioProcessor
from musetalk.utils.utils import datagen
from musetalk.utils.blending import get_image_blending
from transformers import WhisperModel as HfWhisperModel

app = FastAPI(title="Live Realistic Human AI Avatar")

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
muse_vae = None
muse_unet = None
muse_pe = None
muse_audio_processor = None
muse_hf_whisper = None

# Avatar materials
avatar_materials = {
    "latents": None,
    "coords": None,
    "mask_coords": None,
    "frames": None,
    "masks": None,
}

@app.on_event("startup")
def load_all_services():
    global whisper_stt, kokoro_pipeline, muse_vae, muse_unet, muse_pe, muse_audio_processor, muse_hf_whisper
    global avatar_materials

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[*] Initializing real-time pipeline on: {device}")

    # 1. Faster-Whisper
    print("[*] Loading Faster-Whisper base.en...")
    whisper_stt = WhisperModel("base.en", device=device, compute_type="float16")
    print("[+] Faster-Whisper loaded.")

    # 2. Kokoro TTS
    print("[*] Loading Kokoro TTS...")
    kokoro_pipeline = KPipeline(lang_code="a")
    print("[+] Kokoro TTS loaded.")

    # 3. MuseTalk Models
    print("[*] Loading MuseTalk Neural Models (VAE, UNet, Whisper)...")
    vae_path = os.path.join(MUSETALK_DIR, "models", "sd-vae").replace("\\", "/")
    muse_vae = AutoencoderKL.from_pretrained(vae_path, torch_dtype=torch.float16).to(device)

    unet_config_path = os.path.join(MUSETALK_DIR, "models", "musetalk", "musetalk.json")
    unet_weights_path = os.path.join(MUSETALK_DIR, "models", "musetalk", "pytorch_model.bin")
    muse_unet = UNet(unet_config=unet_config_path, model_path=unet_weights_path, device="cpu")
    muse_unet.model.to(device, dtype=torch.float16)

    muse_pe = PositionalEncoding(d_model=384)

    whisper_feature_dir = os.path.join(MUSETALK_DIR, "models", "whisper")
    muse_audio_processor = AudioProcessor(feature_extractor_path=whisper_feature_dir)
    muse_hf_whisper = HfWhisperModel.from_pretrained(whisper_feature_dir, torch_dtype=torch.float16).to(device)

    # 4. Avatar Cached Frame & Latent Materials (Using female avatar 'sun')
    avatar_dir = os.path.join(MUSETALK_DIR, "results", "avatars", "sun")
    full_imgs_dir = os.path.join(avatar_dir, "full_imgs")
    mask_dir = os.path.join(avatar_dir, "mask")

    print("[*] Loading avatar reference video frames...")
    avatar_materials["latents"] = torch.load(os.path.join(avatar_dir, "latents.pt"))
    with open(os.path.join(avatar_dir, "coords.pkl"), "rb") as f:
        avatar_materials["coords"] = pickle.load(f)
    with open(os.path.join(avatar_dir, "mask_coords.pkl"), "rb") as f:
        avatar_materials["mask_coords"] = pickle.load(f)

    frame_paths = sorted([os.path.join(full_imgs_dir, f) for f in os.listdir(full_imgs_dir) if f.endswith(".png")])
    mask_paths = sorted([os.path.join(mask_dir, f) for f in os.listdir(mask_dir) if f.endswith(".png")])

    avatar_materials["frames"] = [cv2.imread(p) for p in frame_paths]
    avatar_materials["masks"] = [cv2.imread(p) for p in mask_paths]
    
    torch.cuda.empty_cache()
    print(f"[+] All models ready! VRAM allocated: {torch.cuda.memory_allocated() / 1e9:.2f} GB")


class AskTextRequest(BaseModel):
    text: str


def query_ollama(prompt: str) -> str:
    url = "http://localhost:11434/api/generate"
    system_prompt = (
        "You are an attractive, friendly, and polite young female AI avatar. "
        "Answer the user naturally in 1 short sentence (maximum 12 words). "
        "Never use markdown, lists, asterisks, or emoji."
    )
    payload = {
        "model": "llama3",
        "prompt": f"{system_prompt}\n\nUser: {prompt}\nAvatar:",
        "stream": False,
        "options": {
            "num_predict": 25,
            "temperature": 0.5
        }
    }
    try:
        res = requests.post(url, json=payload, timeout=15)
        res.raise_for_status()
        ans = res.json().get("response", "").strip()
        sentences = [s.strip() for s in re.split(r'(?<=[.!?]) +', ans) if s.strip()]
        return " ".join(sentences[:1]) if sentences else ans
    except Exception as e:
        print(f"[!] Ollama error: {e}")
        return "Hello! I am glad to meet you."


def generate_speech(text: str, out_wav_path: str):
    generator = kokoro_pipeline(text, voice="af_bella", speed=1.15)
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


def generate_musetalk_avatar(wav_path: str, out_video_path: str):
    device = "cuda" if torch.cuda.is_available() else "cpu"

    # 1. Resample audio to 16kHz for whisper
    temp_16k = wav_path.replace(".wav", "_16k.wav")
    subprocess.run(
        f'ffmpeg -y -i "{wav_path}" -vn -ar 16000 -ac 1 "{temp_16k}"',
        shell=True,
        check=True,
        capture_output=True
    )

    # 2. Extract Whisper features & chunks
    whisper_features_list, librosa_length = muse_audio_processor.get_audio_feature(temp_16k)
    whisper_chunks = muse_audio_processor.get_whisper_chunk(
        whisper_features_list,
        device=device,
        weight_dtype=torch.float16,
        whisper=muse_hf_whisper,
        librosa_length=librosa_length,
        fps=25
    )

    batch_size = 24
    gen = datagen(whisper_chunks, avatar_materials["latents"], batch_size=batch_size)

    res_frames = []
    for whisper_batch, latent_batch in gen:
        if isinstance(whisper_batch, torch.Tensor):
            a_batch = whisper_batch.to(device=device, dtype=torch.float16)
        else:
            a_batch = torch.from_numpy(whisper_batch).to(device=device, dtype=torch.float16)

        a_batch = muse_pe(a_batch).to(dtype=torch.float16)
        l_batch = latent_batch.to(device=device, dtype=torch.float16)

        with torch.no_grad():
            pred_latents = muse_unet.model(l_batch, timestep=0, encoder_hidden_states=a_batch).sample
            recon = muse_vae.decode(pred_latents / 0.18215).sample

        recon = (recon / 2 + 0.5).clamp(0, 1)
        recon = recon.permute(0, 2, 3, 1).cpu().numpy() * 255.0
        for rf in recon:
            res_frames.append(rf.astype(np.uint8))

    # 3. Stream blended frames directly to FFmpeg via pipe (avoids disk I/O bottlenecks)
    frames_cycle = avatar_materials["frames"]
    masks_cycle = avatar_materials["masks"]
    coords_cycle = avatar_materials["coords"]
    mask_coords_cycle = avatar_materials["mask_coords"]
    n_cycle = len(frames_cycle)

    h, w = frames_cycle[0].shape[:2]
    cmd_mux = [
        "ffmpeg", "-y",
        "-f", "rawvideo",
        "-vcodec", "rawvideo",
        "-s", f"{w}x{h}",
        "-pix_fmt", "bgr24",
        "-r", "25",
        "-i", "-",
        "-i", wav_path,
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-shortest",
        out_video_path
    ]

    proc = subprocess.Popen(cmd_mux, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    for idx, res_frame in enumerate(res_frames):
        c_idx = idx % n_cycle
        orig_frame = frames_cycle[c_idx]
        mask = masks_cycle[c_idx]
        bbox = coords_cycle[c_idx]
        mask_coord = mask_coords_cycle[c_idx]

        res_bgr = cv2.cvtColor(res_frame, cv2.COLOR_RGB2BGR)
        res_bgr = cv2.resize(res_bgr, (bbox[2] - bbox[0], bbox[3] - bbox[1]))
        blended = get_image_blending(orig_frame, res_bgr, bbox, mask, mask_coord)
        proc.stdin.write(blended.tobytes())

    proc.stdin.close()
    proc.wait()

    try:
        if os.path.exists(temp_16k):
            os.remove(temp_16k)
    except:
        pass
        pass

    return out_video_path


@app.get("/api/health")
def health_check():
    return {
        "status": "online",
        "gpu": torch.cuda.get_device_name(0) if torch.cuda.is_available() else "CPU",
        "models": {
            "stt": "Faster-Whisper (CUDA)",
            "brain": "Ollama llama3",
            "tts": "Kokoro-82M",
            "avatar": "MuseTalk Neural Lip-Sync"
        }
    }


@app.post("/api/ask-audio")
async def ask_audio(audio: UploadFile = File(...)):
    session_id = uuid.uuid4().hex[:8]
    raw_upload_path = os.path.join(STATIC_DIR, f"upload_{session_id}_{audio.filename or 'audio.webm'}")
    input_wav_path = os.path.join(STATIC_DIR, f"input_{session_id}.wav")
    reply_wav_path = os.path.join(STATIC_DIR, f"reply_{session_id}.wav")
    reply_vid_path = os.path.join(STATIC_DIR, f"response_{session_id}.mp4")

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
        vad_parameters=dict(min_silence_duration_ms=400),
        temperature=0.0
    )
    transcription = " ".join([seg.text.strip() for seg in segments]).strip()
    print(f"[STT User Question]: '{transcription}'")

    # If VAD filtered too aggressively, retry once with raw audio
    if not transcription:
        segments, _ = whisper_stt.transcribe(input_wav_path, language="en", beam_size=3, vad_filter=False)
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

    # 2. Ollama Llama 3 Brain
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
    ai_response = query_ollama(user_text)
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
