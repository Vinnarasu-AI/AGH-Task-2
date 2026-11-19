import React, { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRM, VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

export type AvatarState = "IDLE" | "LISTENING" | "THINKING" | "SPEAKING" | "REACTING";

export interface AIInterviewerAvatarProps {
  /** The interview state machine: IDLE, LISTENING, THINKING, SPEAKING, REACTING */
  interviewState?: AvatarState;
  /** Legacy status string from App.jsx: "Idle" | "Listening" | "Thinking" | "Speaking" */
  status?: string;
  isSpeaking?: boolean;
  isThinking?: boolean;
  isListening?: boolean;
  /** Real-time normalized audio energy level (0.0 to 1.0) from WebAudio */
  audioLevel?: number;
  /** Emotion: "neutral" | "joy" | "sorrow" | "angry" | "fun" */
  emotion?: string;
  /** Path to the VRM model file */
  modelPath?: string;
  className?: string;
}

// Immutable baseline resting pose for professional seated HR interviewer.
// Arms hang close to torso, elbows bend naturally, forearms rest forward across the desk/lap,
// and hands rest near each other with relaxed fingers.
const REST_POSE = {
  spine: { x: 0.0, y: 0.0, z: 0.0 },
  chest: { x: 0.0, y: 0.0, z: 0.0 },
  neck: { x: 0.0, y: 0.0, z: 0.0 },
  head: { x: 0.0, y: 0.0, z: 0.0 },

  // Shoulders relaxed and lowered naturally
  rightShoulder: { x: 0.0, y: 0.0, z: -0.02 },
  leftShoulder: { x: 0.0, y: 0.0, z: 0.02 },

  // Upper arms hang vertically close to the ribs (no splayed or wide elbows)
  rightUpperArm: { x: 0.16, y: 0.06, z: -1.48 },
  leftUpperArm: { x: 0.16, y: -0.06, z: 1.48 },

  // Forearms flex forward and angle naturally across the desk
  rightLowerArm: { x: 0.08, y: 1.18, z: 0.04 },
  leftLowerArm: { x: 0.08, y: -1.18, z: -0.04 },

  // Hands resting comfortably with palms down/inward and gentle wrist alignment
  rightHand: { x: -0.12, y: 0.06, z: -0.04 },
  leftHand: { x: -0.12, y: -0.06, z: 0.04 },
};

export const AIInterviewerAvatar: React.FC<AIInterviewerAvatarProps> = ({
  interviewState,
  status,
  isSpeaking,
  isThinking,
  isListening,
  audioLevel = 0,
  emotion = "neutral",
  modelPath = "/avatars/rocketbox-business-female-01.vrm",
  className = "",
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const vrmRef = useRef<VRM | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);

  const [loadingProgress, setLoadingProgress] = useState<number | null>(10);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);

  // Derive unified avatar state
  const currentState: AvatarState = useMemo(() => {
    if (interviewState) return interviewState;
    if (isSpeaking || status === "Speaking") return "SPEAKING";
    if (isThinking || status === "Thinking") return "THINKING";
    if (isListening || status === "Listening") return "LISTENING";
    if (emotion && emotion !== "neutral" && status !== "Speaking") return "REACTING";
    return "IDLE";
  }, [interviewState, status, isSpeaking, isThinking, isListening, emotion]);

  // Synchronized refs for render loop
  const stateRef = useRef<AvatarState>(currentState);
  const audioLevelRef = useRef<number>(audioLevel);
  const emotionRef = useRef<string>(emotion);

  useEffect(() => {
    stateRef.current = currentState;
  }, [currentState]);

  useEffect(() => {
    audioLevelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    emotionRef.current = emotion;
  }, [emotion]);

  useEffect(() => {
    let isCancelled = false;
    let animFrameId: number | null = null;

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 540;
    const height = container.clientHeight || 560;

    // 1. Scene setup
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Load High-Res Photorealistic Office Background directly into Three.js scene
    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      "/office_background.jpg",
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        scene.background = texture;
      },
      undefined,
      (err) => {
        console.warn("Could not load office background texture:", err);
      }
    );

    // Initial camera placeholder (dynamically positioned once VRM head bone is loaded)
    const camera = new THREE.PerspectiveCamera(28.0, width / height, 0.1, 20.0);
    camera.position.set(0.0, 1.38, 1.68);
    camera.lookAt(new THREE.Vector3(0.0, 1.30, 0.0));

    // 2. Safe WebGL Renderer initialization
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: "high-performance",
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.06;

      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      renderer.domElement.style.display = "block";

      container.appendChild(renderer.domElement);
      rendererRef.current = renderer;
    } catch (e: any) {
      console.error("WebGLRenderer initialization failed:", e);
      setTimeout(() => {
        setErrorMessage("WebGL is not supported or context could not be created in your browser.");
      }, 0);
      return;
    }

    // 3. Studio Lighting matching professional corporate interview
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.45);
    scene.add(ambientLight);

    // Key Light (Upper Front-Right)
    const keyLight = new THREE.DirectionalLight(0xfff8ee, 1.75);
    keyLight.position.set(0.9, 2.2, 1.6);
    scene.add(keyLight);

    // Fill Light (Front-Left)
    const fillLight = new THREE.DirectionalLight(0xe0f2fe, 1.15);
    fillLight.position.set(-1.1, 1.5, 1.3);
    scene.add(fillLight);

    // Clean Rim Light for sharp shoulder & suit silhouette
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.35);
    rimLight.position.set(0.0, 2.3, -1.8);
    scene.add(rimLight);

    // Soft Ambient Bounce Light
    const bounceLight = new THREE.DirectionalLight(0xfef3c7, 0.40);
    bounceLight.position.set(0.0, 0.4, 0.9);
    scene.add(bounceLight);

    // 4. Load VRM Model via Three.js GLTFLoader + VRMLoaderPlugin
    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      modelPath,
      (gltf) => {
        if (isCancelled) return;
        const vrm = gltf.userData.vrm as VRM;
        if (!vrm) {
          setErrorMessage("Failed to parse VRM metadata from model.");
          return;
        }

        // Clean up redundant geometry/joints for maximum performance
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        VRMUtils.rotateVRM0(vrm);

        scene.add(vrm.scene);
        vrmRef.current = vrm;

        // Position camera dynamically based on avatar head height:
        // Framing: SEATED WAIST-UP PORTRAIT (Head, Shoulders, Body & Hands Only, Zero Legs)
        if (vrm.humanoid) {
          // Immediately initialize all arm and shoulder bones to the exact resting pose
          const initBones: [string, { x: number; y: number; z: number }][] = [
            ["rightShoulder", REST_POSE.rightShoulder],
            ["leftShoulder", REST_POSE.leftShoulder],
            ["rightUpperArm", REST_POSE.rightUpperArm],
            ["leftUpperArm", REST_POSE.leftUpperArm],
            ["rightLowerArm", REST_POSE.rightLowerArm],
            ["leftLowerArm", REST_POSE.leftLowerArm],
            ["rightHand", REST_POSE.rightHand],
            ["leftHand", REST_POSE.leftHand],
          ];
          initBones.forEach(([bName, rot]) => {
            const bNode = vrm.humanoid.getNormalizedBoneNode(bName as any);
            if (bNode) {
              bNode.rotation.set(rot.x, rot.y, rot.z);
            }
          });
          vrm.humanoid.update();

          const headNode = vrm.humanoid.getNormalizedBoneNode("head");
          if (headNode) {
            const headPos = new THREE.Vector3();
            headNode.getWorldPosition(headPos);

            // Portrait distance (1.68m) with narrow 28° FOV focused on upper chest:
            // - Head positioned with ~12-14cm clean headroom above hair
            // - Shoulders, neck, suit jacket, and resting hands are in full view
            // - Bottom cuts off cleanly at the waist (Y ~ 0.92m) -> NO LEGS OR FEET VISIBLE
            camera.fov = 28.0;
            camera.position.set(0.0, headPos.y - 0.10, 1.68);
            camera.lookAt(new THREE.Vector3(0.0, headPos.y - 0.18, 0.0));
            camera.updateProjectionMatrix();

            // SUBTLE EXECUTIVE INTERVIEW DESK SURFACE
            // A slim, elegant dark walnut / graphite matte surface that visually supports the forearms
            // at the bottom of the card, completely removing any 'floating hands' look.
            const deskGeo = new THREE.BoxGeometry(2.2, 0.035, 0.50);
            const deskMat = new THREE.MeshStandardMaterial({
              color: 0x1e242c,
              roughness: 0.60,
              metalness: 0.15,
            });
            const deskMesh = new THREE.Mesh(deskGeo, deskMat);
            deskMesh.position.set(0.0, headPos.y - 0.46, 0.28);
            scene.add(deskMesh);

            // Subtle chrome front-edge accent line
            const edgeGeo = new THREE.BoxGeometry(2.22, 0.008, 0.015);
            const edgeMat = new THREE.MeshStandardMaterial({
              color: 0x64748b,
              roughness: 0.25,
              metalness: 0.80,
            });
            const edgeMesh = new THREE.Mesh(edgeGeo, edgeMat);
            edgeMesh.position.set(0.0, headPos.y - 0.445, 0.03);
            scene.add(edgeMesh);
          }
        }

        setLoadingProgress(null);
        setModelLoaded(true);
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          setLoadingProgress(pct);
        }
      },
      (error) => {
        if (isCancelled) return;
        console.error("VRM Load Error:", error);
        setErrorMessage("Could not load avatar: " + (error?.message || "File error"));
        setLoadingProgress(null);
      }
    );

    // 5. Responsive Resize Listener
    const handleResize = () => {
      if (!containerRef.current || !rendererRef.current) return;
      const w = containerRef.current.clientWidth || 540;
      const h = containerRef.current.clientHeight || 560;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener("resize", handleResize);

    // 6. High-Precision Timing & Procedural Animation State Loop
    let lastTime = performance.now();

    let breathTimer = 0;
    let blinkTimer = 0;
    const blinkDuration = 0.15;
    let nextBlinkInterval = 3.2;
    let isBlinking = false;
    let blinkProgress = 0;

    let nodTimer = 0;
    let currentMouthOpen = 0;

    // Gesture Sequencer State
    let speechActiveTime = 0;
    let currentGestureIndex = 0;
    let gestureWeight = 0; // 0.0 = pure rest pose, 1.0 = peak gesture offset
    let targetGestureWeight = 0;

    // Helper to safely set VRM expressions (compatible with VRM 0.x & 1.0)
    const setExpr = (vrm: VRM, names: string[], value: number) => {
      if (!vrm.expressionManager) return;
      for (const name of names) {
        try {
          vrm.expressionManager.setValue(name, value);
        } catch {
          // Ignore unsupported expression names
        }
      }
    };

    // Helper to softly articulate fingers (relaxed human curvature resting on desk - no claw hands!)
    const curlFingers = (vrm: VRM, side: "left" | "right", curl: number = 0.18) => {
      if (!vrm.humanoid) return;
      const digits = ["Index", "Middle", "Ring", "Little"];
      for (let i = 0; i < digits.length; i++) {
        const d = digits[i];
        // Natural human finger cascade: index is slightly straighter, pinky slightly more curved
        const cascade = 0.85 + i * 0.08;
        const prox = vrm.humanoid.getNormalizedBoneNode(`${side}${d}Proximal` as any);
        const inter = vrm.humanoid.getNormalizedBoneNode(`${side}${d}Intermediate` as any);
        const dist = vrm.humanoid.getNormalizedBoneNode(`${side}${d}Distal` as any);
        if (prox) prox.rotation.x = THREE.MathUtils.lerp(prox.rotation.x, curl * cascade * 0.70, 0.12);
        if (inter) inter.rotation.x = THREE.MathUtils.lerp(inter.rotation.x, curl * cascade * 0.90, 0.12);
        if (dist) dist.rotation.x = THREE.MathUtils.lerp(dist.rotation.x, curl * cascade * 0.55, 0.12);
      }
      const thumbProx = vrm.humanoid.getNormalizedBoneNode(`${side}ThumbProximal` as any);
      const thumbDist = vrm.humanoid.getNormalizedBoneNode(`${side}ThumbDistal` as any);
      if (thumbProx) {
        thumbProx.rotation.y = THREE.MathUtils.lerp(thumbProx.rotation.y, side === "left" ? 0.06 : -0.06, 0.12);
        thumbProx.rotation.x = THREE.MathUtils.lerp(thumbProx.rotation.x, curl * 0.25, 0.12);
      }
      if (thumbDist) {
        thumbDist.rotation.x = THREE.MathUtils.lerp(thumbDist.rotation.x, curl * 0.28, 0.12);
      }
    };

    const animate = () => {
      animFrameId = requestAnimationFrame(animate);

      const now = performance.now();
      const delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;

      const vrm = vrmRef.current;
      const st = stateRef.current;
      const audioLvl = audioLevelRef.current;
      const em = emotionRef.current;

      if (vrm) {
        breathTimer += delta;

        // --- A. BONE POSE & GESTURE SYSTEM ---
        if (vrm.humanoid) {
          const head = vrm.humanoid.getNormalizedBoneNode("head");
          const neck = vrm.humanoid.getNormalizedBoneNode("neck");
          const spine = vrm.humanoid.getNormalizedBoneNode("spine");
          const chest = vrm.humanoid.getNormalizedBoneNode("chest");

          const rightShoulder = vrm.humanoid.getNormalizedBoneNode("rightShoulder");
          const leftShoulder = vrm.humanoid.getNormalizedBoneNode("leftShoulder");

          const rightUpperArm = vrm.humanoid.getNormalizedBoneNode("rightUpperArm");
          const rightLowerArm = vrm.humanoid.getNormalizedBoneNode("rightLowerArm");
          const rightHand = vrm.humanoid.getNormalizedBoneNode("rightHand");

          const leftUpperArm = vrm.humanoid.getNormalizedBoneNode("leftUpperArm");
          const leftLowerArm = vrm.humanoid.getNormalizedBoneNode("leftLowerArm");
          const leftHand = vrm.humanoid.getNormalizedBoneNode("leftHand");

          // 1. Natural Diaphragmatic Breathing (Chest, Spine & Shoulders)
          const breathCycle = Math.sin(breathTimer * 1.3);
          const breathChest = breathCycle * 0.014;
          const breathSpine = Math.sin(breathTimer * 1.3 - 0.25) * 0.008;

          if (spine) spine.rotation.x = THREE.MathUtils.lerp(spine.rotation.x, REST_POSE.spine.x + breathSpine, 0.08);
          if (chest) chest.rotation.x = THREE.MathUtils.lerp(chest.rotation.x, REST_POSE.chest.x + breathChest, 0.08);

          // Subtle shoulder breathing elevation
          if (rightShoulder) {
            rightShoulder.rotation.z = THREE.MathUtils.lerp(rightShoulder.rotation.z, REST_POSE.rightShoulder.z - breathCycle * 0.008, 0.08);
          }
          if (leftShoulder) {
            leftShoulder.rotation.z = THREE.MathUtils.lerp(leftShoulder.rotation.z, REST_POSE.leftShoulder.z + breathCycle * 0.008, 0.08);
          }

          // 2. Behavioral State Logic & Discrete Conversational Gestures
          let headTargetX = REST_POSE.head.x;
          let headTargetY = REST_POSE.head.y;
          let headTargetZ = REST_POSE.head.z;
          let neckTargetX = REST_POSE.neck.x;

          // Arm temporary gesture offsets (relative to REST_POSE baseline)
          let rUpperOffset = { x: 0, y: 0, z: 0 };
          let rLowerOffset = { x: 0, y: 0, z: 0 };
          let rHandOffset = { x: 0, y: 0, z: 0 };
          let fingerCurlRight = 0.22; // resting natural curl
          let fingerCurlLeft = 0.22;

          if (st === "SPEAKING") {
            speechActiveTime += delta;

            // Natural conversational head nods on emphasis & cadence
            const speakNod = Math.sin(speechActiveTime * 2.8) * 0.024 - 0.008;
            const speakTilt = Math.sin(speechActiveTime * 1.4) * 0.016;
            const speakTwist = Math.cos(speechActiveTime * 1.1) * 0.014;

            headTargetX += speakNod;
            headTargetY += speakTwist;
            headTargetZ += speakTilt;
            neckTargetX += -0.01;

            // DISCRETE CONVERSATIONAL GESTURE SEQUENCER
            // Gestures occur occasionally (not continuously), with clear beginning, peak, and return-to-rest
            const cycleDuration = 4.8; // 4.8s per gesture decision cycle
            const cycleTime = speechActiveTime % cycleDuration;
            const gestureStart = 1.6; // First 1.6s of cycle is pure resting pose
            const gestureEnd = 3.6;   // 2.0s duration for gesture curve

            if (cycleTime >= gestureStart && cycleTime <= gestureEnd) {
              const progress = (cycleTime - gestureStart) / (gestureEnd - gestureStart); // 0.0 to 1.0
              // Bell curve weighting: starts at 0, peaks at 1, smoothly returns to 0
              targetGestureWeight = Math.sin(progress * Math.PI);
            } else {
              targetGestureWeight = 0.0;
              if (cycleTime < gestureStart) {
                // Determine next gesture variant for upcoming cycle
                currentGestureIndex = Math.floor((speechActiveTime / cycleDuration) % 3);
              }
            }

            // Smoothly interpolate gesture weight to prevent any abrupt jerks
            gestureWeight = THREE.MathUtils.lerp(gestureWeight, targetGestureWeight, delta * 9.0);

            // Three subtle conversational gestures (asymmetric right-hand dominant, arms always return to rest)
            if (currentGestureIndex === 0) {
              // Gesture A: Subtle Emphasis (Right forearm lifts slightly forward with gentle wrist inflection)
              rUpperOffset = { x: 0.12 * gestureWeight, y: 0.14 * gestureWeight, z: 0.08 * gestureWeight };
              rLowerOffset = { x: 0.16 * gestureWeight, y: 0.18 * gestureWeight, z: 0.10 * gestureWeight };
              rHandOffset = { x: -0.12 * gestureWeight, y: 0.06 * gestureWeight, z: -0.08 * gestureWeight };
              fingerCurlRight = THREE.MathUtils.lerp(0.22, 0.16, gestureWeight);
            } else if (currentGestureIndex === 1) {
              // Gesture B: Open Conversational Gesture (Right hand opens slightly outward, then returns)
              rUpperOffset = { x: 0.10 * gestureWeight, y: 0.18 * gestureWeight, z: 0.10 * gestureWeight };
              rLowerOffset = { x: 0.14 * gestureWeight, y: 0.24 * gestureWeight, z: 0.14 * gestureWeight };
              rHandOffset = { x: -0.08 * gestureWeight, y: 0.12 * gestureWeight, z: -0.10 * gestureWeight };
              fingerCurlRight = THREE.MathUtils.lerp(0.22, 0.10, gestureWeight);
            } else {
              // Gesture C: Controlled Point / Explanation Gesture (Short emphasis forward)
              rUpperOffset = { x: 0.14 * gestureWeight, y: 0.10 * gestureWeight, z: 0.06 * gestureWeight };
              rLowerOffset = { x: 0.18 * gestureWeight, y: 0.15 * gestureWeight, z: 0.12 * gestureWeight };
              rHandOffset = { x: -0.15 * gestureWeight, y: 0.04 * gestureWeight, z: -0.05 * gestureWeight };
              fingerCurlRight = THREE.MathUtils.lerp(0.22, 0.18, gestureWeight);
            }

          } else if (st === "THINKING") {
            // THINKING: Hands remain completely resting on desk, head tilts slightly pensive
            gestureWeight = THREE.MathUtils.lerp(gestureWeight, 0.0, delta * 8.0);
            headTargetX = REST_POSE.head.x - 0.035;
            headTargetY = REST_POSE.head.y + 0.045;
            headTargetZ = REST_POSE.head.z - 0.055;
            neckTargetX = REST_POSE.neck.x - 0.015;

          } else if (st === "LISTENING") {
            // LISTENING: Hands remain strictly resting on desk, head facing candidate with periodic empathetic nod
            gestureWeight = THREE.MathUtils.lerp(gestureWeight, 0.0, delta * 8.0);
            nodTimer += delta;
            let nodOffset = 0;
            if (nodTimer > 4.2) {
              const nodPhase = (nodTimer - 4.2) * 4.2;
              if (nodPhase < Math.PI * 2) {
                nodOffset = Math.sin(nodPhase) * 0.032;
              } else {
                nodTimer = 0;
              }
            }

            headTargetX = REST_POSE.head.x + 0.025 + nodOffset;
            headTargetY = REST_POSE.head.y + Math.sin(breathTimer * 0.45) * 0.010;
            headTargetZ = REST_POSE.head.z;
            neckTargetX = REST_POSE.neck.x + 0.015;

          } else {
            // IDLE: Calm, professional seated presence with subtle breathing micro-motions
            gestureWeight = THREE.MathUtils.lerp(gestureWeight, 0.0, delta * 8.0);
            headTargetX = REST_POSE.head.x + Math.cos(breathTimer * 0.38) * 0.008;
            headTargetY = REST_POSE.head.y + Math.sin(breathTimer * 0.50) * 0.012;
            headTargetZ = REST_POSE.head.z + Math.sin(breathTimer * 0.30) * 0.006;
            neckTargetX = REST_POSE.neck.x;
          }

          // Apply smoothly blended head and neck rotations
          if (head) {
            head.rotation.x = THREE.MathUtils.lerp(head.rotation.x, headTargetX, 0.10);
            head.rotation.y = THREE.MathUtils.lerp(head.rotation.y, headTargetY, 0.10);
            head.rotation.z = THREE.MathUtils.lerp(head.rotation.z, headTargetZ, 0.10);
          }
          if (neck) {
            neck.rotation.x = THREE.MathUtils.lerp(neck.rotation.x, neckTargetX, 0.08);
          }

          // 3. Apply baseline resting pose + temporary gesture offsets to arms
          // Right Arm (Applies gesture offset relative to REST_POSE baseline)
          if (rightUpperArm) {
            rightUpperArm.rotation.x = THREE.MathUtils.lerp(rightUpperArm.rotation.x, REST_POSE.rightUpperArm.x + rUpperOffset.x, 0.10);
            rightUpperArm.rotation.y = THREE.MathUtils.lerp(rightUpperArm.rotation.y, REST_POSE.rightUpperArm.y + rUpperOffset.y, 0.10);
            rightUpperArm.rotation.z = THREE.MathUtils.lerp(rightUpperArm.rotation.z, REST_POSE.rightUpperArm.z + rUpperOffset.z, 0.10);
          }
          if (rightLowerArm) {
            rightLowerArm.rotation.x = THREE.MathUtils.lerp(rightLowerArm.rotation.x, REST_POSE.rightLowerArm.x + rLowerOffset.x, 0.10);
            rightLowerArm.rotation.y = THREE.MathUtils.lerp(rightLowerArm.rotation.y, REST_POSE.rightLowerArm.y + rLowerOffset.y, 0.10);
            rightLowerArm.rotation.z = THREE.MathUtils.lerp(rightLowerArm.rotation.z, REST_POSE.rightLowerArm.z + rLowerOffset.z, 0.10);
          }
          if (rightHand) {
            rightHand.rotation.x = THREE.MathUtils.lerp(rightHand.rotation.x, REST_POSE.rightHand.x + rHandOffset.x, 0.10);
            rightHand.rotation.y = THREE.MathUtils.lerp(rightHand.rotation.y, REST_POSE.rightHand.y + rHandOffset.y, 0.10);
            rightHand.rotation.z = THREE.MathUtils.lerp(rightHand.rotation.z, REST_POSE.rightHand.z + rHandOffset.z, 0.10);
          }

          // Left Arm (Anchored stably in resting pose with gentle sympathetic breathing settle)
          const leftSettle = Math.sin(breathTimer * 1.3) * 0.005;
          if (leftUpperArm) {
            leftUpperArm.rotation.x = THREE.MathUtils.lerp(leftUpperArm.rotation.x, REST_POSE.leftUpperArm.x, 0.08);
            leftUpperArm.rotation.y = THREE.MathUtils.lerp(leftUpperArm.rotation.y, REST_POSE.leftUpperArm.y, 0.08);
            leftUpperArm.rotation.z = THREE.MathUtils.lerp(leftUpperArm.rotation.z, REST_POSE.leftUpperArm.z, 0.08);
          }
          if (leftLowerArm) {
            leftLowerArm.rotation.x = THREE.MathUtils.lerp(leftLowerArm.rotation.x, REST_POSE.leftLowerArm.x + leftSettle, 0.08);
            leftLowerArm.rotation.y = THREE.MathUtils.lerp(leftLowerArm.rotation.y, REST_POSE.leftLowerArm.y, 0.08);
            leftLowerArm.rotation.z = THREE.MathUtils.lerp(leftLowerArm.rotation.z, REST_POSE.leftLowerArm.z, 0.08);
          }
          if (leftHand) {
            leftHand.rotation.x = THREE.MathUtils.lerp(leftHand.rotation.x, REST_POSE.leftHand.x, 0.08);
            leftHand.rotation.y = THREE.MathUtils.lerp(leftHand.rotation.y, REST_POSE.leftHand.y, 0.08);
            leftHand.rotation.z = THREE.MathUtils.lerp(leftHand.rotation.z, REST_POSE.leftHand.z, 0.08);
          }

          // Articulate relaxed resting fingers
          curlFingers(vrm, "right", fingerCurlRight);
          curlFingers(vrm, "left", fingerCurlLeft);
        }

        // --- B. NATURAL PERIODIC EYE BLINKING & SUBTLE SACCADES ---
        blinkTimer += delta;
        if (!isBlinking && blinkTimer > nextBlinkInterval) {
          isBlinking = true;
          blinkProgress = 0;
          blinkTimer = 0;
          nextBlinkInterval = 3.0 + Math.random() * 2.0;
        }

        let blinkWeight = 0;
        if (isBlinking) {
          blinkProgress += delta / blinkDuration;
          if (blinkProgress <= 1.0) {
            // Quadratic blink curve (fast shut, soft reopening)
            blinkWeight = Math.sin(blinkProgress * Math.PI);
          } else {
            isBlinking = false;
            blinkWeight = 0;
          }
        }
        setExpr(vrm, ["blink"], blinkWeight);

        // Subtle Living Eye Saccades (Eyes micro-dart naturally around candidate)
        const eyeSaccadeX = Math.sin(breathTimer * 0.70) * 0.035;
        const eyeSaccadeY = Math.cos(breathTimer * 0.85) * 0.020;
        setExpr(vrm, ["lookleft", "lookLeft"], Math.max(0, -eyeSaccadeX));
        setExpr(vrm, ["lookright", "lookRight"], Math.max(0, eyeSaccadeX));

        // --- C. SUBTLE, REALISTIC LIP-SYNC (SMALL, NATURAL MOUTH OPENING) ---
        if (st === "SPEAKING") {
          // Maximum jaw drop capped at 0.22 (small, natural mouth movement)
          const targetMouth = Math.min(0.22, Math.max(0.0, audioLvl * 0.38));
          currentMouthOpen = THREE.MathUtils.lerp(currentMouthOpen, targetMouth, 0.25);

          // Cycle through articulate subtle visemes (horizontal spread & soft vowels)
          const vowelCycle = Math.sin(speechActiveTime * 2.5);
          const openA = currentMouthOpen * (0.45 + 0.20 * Math.max(0, vowelCycle)); // Max ~0.14
          const openI = currentMouthOpen * (0.35 + 0.25 * Math.max(0, -vowelCycle)); // Max ~0.15
          const openO = currentMouthOpen * 0.12; // Max ~0.03
          const openE = currentMouthOpen * 0.18; // Max ~0.04

          setExpr(vrm, ["aa", "a"], openA);
          setExpr(vrm, ["ih", "i"], openI);
          setExpr(vrm, ["oh", "o"], openO);
          setExpr(vrm, ["ee", "e"], openE);
          setExpr(vrm, ["ou", "u"], 0.0);
        } else {
          // Smoothly close mouth to 0 when not speaking
          currentMouthOpen = THREE.MathUtils.lerp(currentMouthOpen, 0.0, 0.35);
          setExpr(vrm, ["aa", "a"], currentMouthOpen);
          setExpr(vrm, ["ih", "i"], 0.0);
          setExpr(vrm, ["oh", "o"], 0.0);
          setExpr(vrm, ["ee", "e"], 0.0);
          setExpr(vrm, ["ou", "u"], 0.0);
        }

        // --- D. EMOTIONS & FACIAL EXPRESSIONS ---
        const isHappy = em === "joy" || em === "happy";
        const isSad = em === "sorrow" || em === "sad";
        const isAngry = em === "angry";
        const isSurprised = em === "fun" || em === "surprised";

        setExpr(vrm, ["happy", "joy"], isHappy ? 0.85 : 0.0);
        setExpr(vrm, ["sad", "sorrow"], isSad ? 0.75 : 0.0);
        setExpr(vrm, ["angry"], isAngry ? 0.75 : 0.0);
        setExpr(vrm, ["surprised", "fun"], isSurprised ? 0.70 : 0.0);

        // Pensive gaze shift during THINKING
        if (st === "THINKING") {
          setExpr(vrm, ["lookup", "lookUp"], 0.18);
          setExpr(vrm, ["lookleft", "lookLeft"], 0.12);
        } else {
          setExpr(vrm, ["lookup", "lookUp"], Math.max(0, eyeSaccadeY));
          setExpr(vrm, ["lookdown", "lookDown"], Math.max(0, -eyeSaccadeY));
        }

        // Update VRM springs, physics, and transforms
        vrm.update(delta);
      }

      renderer.render(scene, camera);
    };

    animate();

    // 7. Complete Three.js Resource Cleanup on Unmount
    return () => {
      isCancelled = true;
      if (animFrameId) cancelAnimationFrame(animFrameId);
      window.removeEventListener("resize", handleResize);

      if (vrmRef.current) {
        VRMUtils.deepDispose(vrmRef.current.scene);
        vrmRef.current = null;
      }

      if (sceneRef.current) {
        sceneRef.current.clear();
        sceneRef.current = null;
      }

      if (rendererRef.current) {
        const dom = rendererRef.current.domElement;
        if (dom && dom.parentNode) {
          dom.parentNode.removeChild(dom);
        }
        rendererRef.current.dispose();
        rendererRef.current = null;
      }
    };
  }, [modelPath]);

  return (
    <div
      ref={containerRef}
      className={`ai-avatar-container ${className}`}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: "480px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "16px",
        overflow: "hidden",
        boxShadow: "0 10px 30px -10px rgba(0,0,0,0.5)",
      }}
    >
      {/* Loading Overlay */}
      {loadingProgress !== null && !errorMessage && (
        <div
          style={{
            position: "absolute",
            zIndex: 10,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
            color: "#94a3b8",
            fontSize: "14px",
            background: "rgba(15, 23, 42, 0.85)",
            padding: "20px 30px",
            borderRadius: "12px",
          }}
        >
          <div
            style={{
              width: "42px",
              height: "42px",
              border: "3px solid #334155",
              borderTopColor: "#38bdf8",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <span>Loading Avatar ({loadingProgress}%)...</span>
        </div>
      )}

      {/* Error State */}
      {errorMessage && (
        <div
          style={{
            position: "absolute",
            zIndex: 10,
            color: "#f87171",
            fontSize: "14px",
            padding: "24px",
            textAlign: "center",
            maxWidth: "80%",
            background: "rgba(15, 23, 42, 0.85)",
            borderRadius: "12px",
            border: "1px solid rgba(248, 113, 113, 0.3)",
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* Subtle State Badge in lower corner */}
      {modelLoaded && (
        <div
          style={{
            position: "absolute",
            bottom: "16px",
            left: "16px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "6px 12px",
            borderRadius: "20px",
            background: "rgba(15, 23, 42, 0.80)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            fontSize: "12px",
            color: "#e2e8f0",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          <span
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor:
                currentState === "SPEAKING"
                  ? "#22c55e"
                  : currentState === "THINKING"
                  ? "#eab308"
                  : currentState === "LISTENING"
                  ? "#38bdf8"
                  : "#94a3b8",
              boxShadow:
                currentState === "SPEAKING"
                  ? "0 0 8px #22c55e"
                  : currentState === "THINKING"
                  ? "0 0 8px #eab308"
                  : currentState === "LISTENING"
                  ? "0 0 8px #38bdf8"
                  : "none",
            }}
          />
          <span style={{ fontWeight: 500, textTransform: "capitalize" }}>
            {currentState === "SPEAKING"
              ? "Avatar Speaking"
              : currentState === "THINKING"
              ? "Thinking..."
              : currentState === "LISTENING"
              ? "Listening..."
              : "Ready to Chat"}
          </span>
        </div>
      )}
    </div>
  );
};

export default AIInterviewerAvatar;
