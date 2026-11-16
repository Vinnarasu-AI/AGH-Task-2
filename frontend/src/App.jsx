import React, { useState, useRef, useEffect } from "react";
import { Mic, Square, Sparkles, Volume2, CheckCircle2, RefreshCw, Send } from "lucide-react";
import VRMAvatar from "./VRMAvatar";
import "./App.css";

function App() {
  const [status, setStatus] = useState("Idle"); // Idle, Listening, Thinking, Speaking
  const [userText, setUserText] = useState("");
  const [aiText, setAiText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [backendHealth, setBackendHealth] = useState(null);
  const [micAudioLevel, setMicAudioLevel] = useState(0);
  const [avatarMouthLevel, setAvatarMouthLevel] = useState(0);

  // Audio device selection
  const [audioDevices, setAudioDevices] = useState([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [manualText, setManualText] = useState("");

  const audioPlayRef = useRef(null);
  const animFrameIdRef = useRef(null);

  // Audio recording refs
  const mediaRecorderRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const recordingStartTimeRef = useRef(0);
  const recordedChunksRef = useRef([]);

  const loadMicrophoneDevices = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter((d) => d.kind === "audioinput");
        setAudioDevices(audioInputs);
        if (audioInputs.length > 0 && !selectedDeviceId) {
          setSelectedDeviceId(audioInputs[0].deviceId);
        }
      }
    } catch (e) {
      console.warn("Could not enumerate audio devices:", e);
    }
  };

  useEffect(() => {
    fetch("http://127.0.0.1:8000/api/health")
      .then((res) => res.json())
      .then((data) => setBackendHealth(data))
      .catch((err) => console.error("Health check error:", err));

    loadMicrophoneDevices();
  }, []);

  // Start microphone recording
  const startRecording = async () => {
    try {
      recordedChunksRef.current = [];

      const audioConstraints = {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: true,
      };

      if (selectedDeviceId) {
        audioConstraints.deviceId = { exact: selectedDeviceId };
      }

      const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
      loadMicrophoneDevices();

      // AudioContext for live volume meter
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioCtx;
      if (audioCtx.state === "suspended") {
        await audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const updateVolume = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          setMicAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
          requestAnimationFrame(updateVolume);
        }
      };
      updateVolume();

      // MediaRecorder
      let mimeType = "";
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        mimeType = "audio/webm;codecs=opus";
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        mimeType = "audio/webm";
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        source.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        if (audioCtx.state !== "closed") {
          try {
            await audioCtx.close();
          } catch (e) {}
        }
        setMicAudioLevel(0);

        const recordedBlob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || "audio/webm" });
        console.log("Recorded audio blob size:", recordedBlob.size);
        await sendAudioToBackend(recordedBlob);
      };

      mediaRecorderRef.current = recorder;
      recorder.start(100);
      recordingStartTimeRef.current = Date.now();
      setIsRecording(true);
      setStatus("Listening");
    } catch (err) {
      console.error("Microphone access failed:", err);
      alert("Microphone permission denied or device not found: " + err.message);
      setStatus("Idle");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      const duration = Date.now() - recordingStartTimeRef.current;
      if (duration < 1000) {
        setTimeout(() => {
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            mediaRecorderRef.current.stop();
          }
          setIsRecording(false);
          setStatus("Thinking");
        }, 500);
      } else {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        setStatus("Thinking");
      }
    }
  };

  // Send voice to backend
  const sendAudioToBackend = async (blob) => {
    if (!blob || blob.size < 500) {
      alert("No audio captured. Please speak into the mic while recording.");
      setStatus("Idle");
      return;
    }

    setStatus("Thinking");
    const formData = new FormData();
    formData.append("audio", blob, "recording.webm");

    try {
      const response = await fetch("http://127.0.0.1:8000/api/ask-audio", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const errMsg = errJson && errJson.detail ? errJson.detail : "Server error (" + response.status + ")";
        throw new Error(errMsg);
      }

      const result = await response.json();
      setUserText(result.user_text || "");
      setAiText(result.ai_text || "");

      if (result.audio_url) {
        playRealtimeAudioSync(result.audio_url);
      } else {
        setStatus("Idle");
      }
    } catch (error) {
      console.error("Inference request failed:", error);
      alert(error.message || "Error generating avatar response.");
      setStatus("Idle");
    }
  };

  // Text input fallback
  const handleSendText = async (e) => {
    e.preventDefault();
    if (!manualText.trim() || status === "Thinking" || status === "Speaking") return;

    const question = manualText.trim();
    setManualText("");
    setUserText(question);
    setStatus("Thinking");

    try {
      const response = await fetch("http://127.0.0.1:8000/api/ask-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: question }),
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        const errMsg = errJson && errJson.detail ? errJson.detail : "Server error (" + response.status + ")";
        throw new Error(errMsg);
      }

      const result = await response.json();
      setAiText(result.ai_text || "");

      if (result.audio_url) {
        playRealtimeAudioSync(result.audio_url);
      } else {
        setStatus("Idle");
      }
    } catch (error) {
      console.error("Inference request failed:", error);
      alert(error.message || "Error generating response.");
      setStatus("Idle");
    }
  };

  // Synchronized Three-VRM Audio Analysis
  const playRealtimeAudioSync = (audioUrl) => {
    setStatus("Speaking");

    if (audioPlayRef.current) {
      audioPlayRef.current.pause();
    }
    if (animFrameIdRef.current) {
      cancelAnimationFrame(animFrameIdRef.current);
    }

    const audio = new Audio(audioUrl);
    audio.crossOrigin = "anonymous";
    audioPlayRef.current = audio;

    let audioCtx = null;
    let analyserNode = null;
    let freqData = null;

    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const sourceNode = audioCtx.createMediaElementSource(audio);
      analyserNode = audioCtx.createAnalyser();
      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.25;
      sourceNode.connect(analyserNode);
      analyserNode.connect(audioCtx.destination);
      freqData = new Uint8Array(analyserNode.frequencyBinCount);
    } catch (e) {
      console.warn("AudioContext setup warning:", e);
    }

    const lipLoop = () => {
      if (!audio.paused && !audio.ended) {
        let level = 0;

        if (analyserNode && freqData) {
          analyserNode.getByteFrequencyData(freqData);
          // Human voice formant bins 2..28 (~300Hz to 3400Hz)
          let sum = 0;
          const low = 2;
          const high = 28;
          for (let i = low; i < high; i++) {
            sum += freqData[i];
          }
          const energy = sum / (high - low);
          if (energy > 8) {
            level = Math.min(1.0, (energy - 8) / 36);
          } else {
            level = 0.0;
          }
        } else {
          const t = audio.currentTime;
          level = Math.max(0, Math.sin(t * 14) * 0.8 + 0.2);
        }

        setAvatarMouthLevel(level);
        animFrameIdRef.current = requestAnimationFrame(lipLoop);
      }
    };

    audio.onplay = () => {
      if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
      }
      lipLoop();
    };

    audio.onended = () => {
      if (animFrameIdRef.current) cancelAnimationFrame(animFrameIdRef.current);
      setAvatarMouthLevel(0);
      setStatus("Idle");
      if (audioCtx && audioCtx.state !== "closed") {
        try {
          audioCtx.close();
        } catch (e) {}
      }
    };

    audio.play().catch((e) => {
      console.error("Audio playback error:", e);
      setStatus("Idle");
    });
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="logo-group">
          <Sparkles className="sparkle-icon" />
          <h1>Live Human AI Avatar</h1>
        </div>
        <div className="health-badge">
          {backendHealth ? (
            <span className="badge-online">
              <CheckCircle2 size={14} /> Pipeline Ready ({backendHealth.gpu})
            </span>
          ) : (
            <span className="badge-loading">
              <RefreshCw size={14} className="spin" /> Connecting Pipeline...
            </span>
          )}
        </div>
      </header>

      {/* Main Layout */}
      <main className="main-content">
        {/* Left: 3D VRM Female Avatar */}
        <div className="avatar-section">
          <div className="avatar-card">
            <div className="video-wrapper">
              <VRMAvatar
                isSpeaking={status === "Speaking"}
                isThinking={status === "Thinking"}
                audioLevel={status === "Speaking" ? avatarMouthLevel : 0}
              />
              <div className={`status-pill status-${status.toLowerCase()}`}>
                <span className="pulse-dot"></span>
                <span>{status}</span>
              </div>
            </div>

            {/* Mic selector */}
            {audioDevices.length > 1 && (
              <div className="device-select-bar">
                <label>Microphone:</label>
                <select
                  value={selectedDeviceId}
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  disabled={isRecording}
                >
                  {audioDevices.map((d, i) => (
                    <option key={d.deviceId || i} value={d.deviceId}>
                      {d.label || `Microphone ${i + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Controls */}
            <div className="controls-bar">
              {isRecording && (
                <div className="volume-meter-wrapper">
                  <div className="volume-bar-track">
                    <div
                      className="volume-bar-fill"
                      style={{ width: `${Math.max(5, micAudioLevel)}%` }}
                    />
                  </div>
                  <span className="volume-label">
                    {micAudioLevel > 5 ? `Speaking (Level: ${micAudioLevel}%)` : "Waiting for voice... (Speak aloud)"}
                  </span>
                </div>
              )}

              {!isRecording ? (
                <button
                  className="btn-mic"
                  onClick={startRecording}
                  disabled={status === "Thinking" || status === "Speaking"}
                >
                  <Mic size={22} />
                  <span>Start Speaking</span>
                </button>
              ) : (
                <button className="btn-stop" onClick={stopRecording}>
                  <Square size={20} />
                  <span>Stop & Process</span>
                </button>
              )}
            </div>

            {/* Text prompt form */}
            <form className="text-prompt-form" onSubmit={handleSendText}>
              <input
                type="text"
                placeholder="Or type a question to test live lip-sync..."
                value={manualText}
                onChange={(e) => setManualText(e.target.value)}
                disabled={status === "Thinking" || status === "Speaking"}
              />
              <button
                type="submit"
                disabled={!manualText.trim() || status === "Thinking" || status === "Speaking"}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        </div>

        {/* Right: Transcript & Pipeline Details */}
        <div className="transcript-section">
          <div className="card transcript-card">
            <h3>Recognized Speech (Whisper)</h3>
            <div className="text-box user-box">
              {userText ? (
                <p>{userText}</p>
              ) : (
                <span className="placeholder-text">Click 'Start Speaking' or type below...</span>
              )}
            </div>
          </div>

          <div className="card transcript-card">
            <h3>AI Response (Ollama Llama 3)</h3>
            <div className="text-box ai-box">
              {aiText ? (
                <p>{aiText}</p>
              ) : (
                <span className="placeholder-text">The AI response will appear here...</span>
              )}
            </div>
          </div>

          <div className="card info-card">
            <h4>Live AI Avatar Pipeline</h4>
            <ul className="pipeline-list">
              <li>
                <strong>STT:</strong> Faster-Whisper (CUDA)
              </li>
              <li>
                <strong>Brain:</strong> Ollama (llama3)
              </li>
              <li>
                <strong>Voice:</strong> Kokoro TTS (af_bella)
              </li>
              <li>
                <strong>Face Lip-Sync:</strong> 3D VRM Mesh Blendshapes (`@pixiv/three-vrm`)
              </li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
