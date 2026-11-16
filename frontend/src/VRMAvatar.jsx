import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

export default function VRMAvatar({ isSpeaking, isThinking, audioLevel = 0 }) {
  const mountRef = useRef(null);
  const vrmRef = useRef(null);
  const audioLevelRef = useRef(audioLevel);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    let animId = null;
    let clock = new THREE.Clock();
    let isCancelled = false;

    const container = mountRef.current;
    if (!container) return;

    // 1. Scene setup
    const scene = new THREE.Scene();

    // 2. Camera setup focused on upper torso and face
    const width = container.clientWidth || 450;
    const height = container.clientHeight || 520;
    const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 20);
    // Position camera directly in front of head/upper body
    camera.position.set(0.0, 1.42, 0.95);
    camera.lookAt(new THREE.Vector3(0.0, 1.35, 0.0));

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);

    // 4. Lighting for beautiful soft skin and hair highlights
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfff5ea, 1.5);
    dirLight.position.set(1.0, 2.0, 1.5);
    scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0xd4e4ff, 0.8);
    fillLight.position.set(-1.0, 1.0, 1.0);
    scene.add(fillLight);

    // 5. Load female VRM Model
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    console.log('[*] Loading VRM avatar from /models/avatar.vrm...');
    loader.load(
      '/models/avatar.vrm',
      (gltf) => {
        if (isCancelled) return;
        const vrm = gltf.userData.vrm;
        vrmRef.current = vrm;

        // Optimize model & rotate to face camera if needed
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        vrm.scene.rotation.y = Math.PI; // Face the camera forward

        scene.add(vrm.scene);
        setLoading(false);
        console.log('[+] VRM female avatar loaded successfully:', vrm);
      },
      (progress) => {
        // loading progress
      },
      (error) => {
        console.error('Failed to load VRM model:', error);
        setLoadError('Failed to load VRM avatar: ' + error.message);
        setLoading(false);
      }
    );

    // 6. Handle responsive window resizing
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth || 450;
      const h = container.clientHeight || 520;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 7. Animation Loop (Lip-sync, Breathing, Blinking)
    let blinkTimer = 0;
    let blinkValue = 0;
    let isBlinking = false;

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const time = clock.getElapsedTime();

      const vrm = vrmRef.current;
      if (vrm) {
        // --- A. Natural Breathing (Subtle chest and spine oscillation) ---
        if (vrm.humanoid) {
          const spine = vrm.humanoid.getNormalizedBoneNode('spine');
          if (spine) {
            spine.rotation.x = Math.sin(time * 1.8) * 0.015;
          }
          const neck = vrm.humanoid.getNormalizedBoneNode('neck');
          if (neck) {
            neck.rotation.y = Math.sin(time * 0.8) * 0.03;
            neck.rotation.z = Math.cos(time * 0.6) * 0.015;
          }
        }

        // --- B. Natural Eye Blinking ---
        blinkTimer += delta;
        if (!isBlinking && blinkTimer > 3.2) {
          isBlinking = true;
          blinkTimer = 0;
        }

        if (isBlinking) {
          blinkValue += delta * 14;
          if (blinkValue >= Math.PI) {
            blinkValue = 0;
            isBlinking = false;
          }
          const blinkProgress = Math.sin(blinkValue);
          if (vrm.expressionManager) {
            vrm.expressionManager.setValue('blink', Math.max(0, Math.min(1, blinkProgress)));
          }
        } else {
          if (vrm.expressionManager) {
            vrm.expressionManager.setValue('blink', 0.0);
          }
        }

        // --- C. Real-Time 3D Lip Sync ---
        // Expression 'aa' (Vowel / Mouth Open) bound directly to audioLevel
        const level = audioLevelRef.current || 0;
        // Map audio level smoothly to mouth opening [0.0 to 1.0]
        const targetOpen = Math.min(1.0, Math.max(0, level * 1.6));

        if (vrm.expressionManager) {
          // Native 3D blendshape deformation - inside the real face!
          vrm.expressionManager.setValue('aa', targetOpen);
          vrm.expressionManager.setValue('oh', targetOpen > 0.4 ? targetOpen * 0.5 : 0.0);
        }

        // Update VRM internal spring bones and expressions
        vrm.update(delta);
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      isCancelled = true;
      if (animId) cancelAnimationFrame(animId);
      window.removeEventListener('resize', handleResize);
      if (renderer.domElement && container) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: '480px',
        borderRadius: '14px',
        overflow: 'hidden',
        background: 'radial-gradient(circle at 50% 30%, #1e293b 0%, #0b0f19 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {loading && (
        <div style={{ color: '#94a3b8', fontSize: '14px', position: 'absolute' }}>
          Loading 3D Female Avatar...
        </div>
      )}
      {loadError && (
        <div style={{ color: '#ef4444', fontSize: '14px', position: 'absolute', padding: '16px' }}>
          {loadError}
        </div>
      )}
    </div>
  );
}
