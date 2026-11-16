import React, { useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display/cubism4';

// Register PIXI global required by pixi-live2d-display
window.PIXI = PIXI;
Live2DModel.registerTicker(PIXI.Ticker);

export default function Live2DAvatar({ isSpeaking, isThinking, audioLevel = 0 }) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const modelRef = useRef(null);
  const appRef = useRef(null);
  const audioLevelRef = useRef(audioLevel);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    let isCancelled = false;

    async function initPixi() {
      if (!canvasRef.current || !containerRef.current) return;

      const container = containerRef.current;
      const initialW = container.clientWidth || 450;
      const initialH = container.clientHeight || 520;

      // Initialize Pixi application
      const app = new PIXI.Application({
        view: canvasRef.current,
        width: initialW,
        height: initialH,
        autoStart: true,
        backgroundAlpha: 0,
        antialias: true,
      });
      appRef.current = app;

      try {
        console.log('[*] Initializing Live2D Haru model...');
        const model = await Live2DModel.from('/live2d/haru/haru_greeter_t03.model3.json', {
          autoInteract: false,
          idleMotionGroup: 'Idle',
        });

        if (isCancelled) {
          model.destroy();
          return;
        }

        modelRef.current = model;
        app.stage.addChild(model);

        // Adjust scale and center the model's face & shoulders
        const resizeModel = () => {
          if (!containerRef.current || !modelRef.current || !appRef.current) return;
          const w = containerRef.current.clientWidth || 450;
          const h = containerRef.current.clientHeight || 520;

          appRef.current.renderer.resize(w, h);

          // Standard Haru canvas is 2400x4500
          const scale = Math.min(w / model.width, h / model.height) * 1.7;
          model.scale.set(scale);
          model.x = (w - model.width * scale) / 2;
          model.y = -model.height * scale * 0.05;
        };

        resizeModel();
        window.addEventListener('resize', resizeModel);

        // ROOT CAUSE FIX: Hook into 'beforeModelUpdate' event!
        // In Cubism 4, motion files constantly overwrite parameters.
        // Listening to 'beforeModelUpdate' guarantees our audio-reactive
        // mouth opening (ParamMouthOpenY and ParamMouthForm) is injected
        // AFTER the motion update and BEFORE the core model commits to GPU rendering!
        model.internalModel.on('beforeModelUpdate', () => {
          const core = model.internalModel.coreModel;
          if (!core) return;

          const level = audioLevelRef.current || 0;
          // Scale parameter to mouth opening [0.0 to 1.0]
          const targetOpen = Math.min(1.0, Math.max(0, level * 1.8));

          try {
            // Parameter 1: ParamMouthOpenY (Mouth opening height)
            core.setParameterValueById('ParamMouthOpenY', targetOpen);

            // Parameter 2: ParamMouthForm (Shape: 0 = neutral, positive = happy/phoneme)
            if (targetOpen > 0.05) {
              core.setParameterValueById('ParamMouthForm', 0.3);
            } else {
              core.setParameterValueById('ParamMouthForm', 0.0);
            }
          } catch (e) {
            console.warn('Error setting mouth parameter:', e);
          }
        });

        console.log('[+] Live2D model initialized with beforeModelUpdate audio hook.');
      } catch (err) {
        console.error('Failed to load Live2D model:', err);
        setLoadError(err.message || 'Error loading Live2D avatar');
      }
    }

    initPixi();

    return () => {
      isCancelled = true;
      if (appRef.current) {
        appRef.current.destroy(true, { children: true, texture: true, baseTexture: true });
        appRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '480px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(180deg, #101626 0%, #0d121f 100%)',
        overflow: 'hidden',
        borderRadius: '14px',
      }}
    >
      {loadError && (
        <div style={{ color: '#ef4444', fontSize: '14px', padding: '16px', textAlign: 'center' }}>
          {loadError}
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: '100%',
          display: loadError ? 'none' : 'block',
        }}
      />
    </div>
  );
}
