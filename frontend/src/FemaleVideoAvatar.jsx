import React, { useEffect, useRef } from "react";

export default function FemaleVideoAvatar({ isSpeaking, isThinking, audioLevel = 0 }) {
  const canvasRef = useRef(null);
  const idleFramesRef = useRef([]);
  const talkFramesRef = useRef([]);
  const animFrameIdRef = useRef(null);
  const isSpeakingRef = useRef(isSpeaking);
  const audioLevelRef = useRef(audioLevel);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    // 1. Preload idle frames (00..39)
    const idleList = [];
    for (let i = 0; i < 40; i++) {
      const img = new Image();
      img.src = `/sun_seq_${String(i).padStart(2, "0")}.jpg`;
      idleList.push(img);
    }
    idleFramesRef.current = idleList;

    // 2. Preload active talk frames (00..49)
    const talkList = [];
    for (let i = 0; i < 50; i++) {
      const img = new Image();
      img.src = `/talk_seq_${String(i).padStart(2, "0")}.jpg`;
      talkList.push(img);
    }
    talkFramesRef.current = talkList;

    let idleIndex = 0;
    let talkIndex = 0;
    let lastTime = performance.now();

    const fps = 25; // 25 fps matching source video
    const frameInterval = 1000 / fps;

    const renderLoop = (currentTime) => {
      animFrameIdRef.current = requestAnimationFrame(renderLoop);

      const elapsed = currentTime - lastTime;
      if (elapsed < frameInterval) return;
      lastTime = currentTime - (elapsed % frameInterval);

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (isSpeakingRef.current) {
        // Active speaking: loop through articulating talk frames
        if (talkFramesRef.current.length > 0) {
          const img = talkFramesRef.current[talkIndex % talkFramesRef.current.length];
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
          talkIndex++;
        }
      } else {
        // Idle breathing & natural blinking
        if (idleFramesRef.current.length > 0) {
          const img = idleFramesRef.current[idleIndex % idleFramesRef.current.length];
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          }
          idleIndex++;
        }
      }
    };

    animFrameIdRef.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animFrameIdRef.current) {
        cancelAnimationFrame(animFrameIdRef.current);
      }
    };
  }, []);

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "480px",
        borderRadius: "14px",
        overflow: "hidden",
        backgroundColor: "#0d1117",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <canvas
        ref={canvasRef}
        width={432}
        height={576}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          display: "block",
        }}
      />
    </div>
  );
}
