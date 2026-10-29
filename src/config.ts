// All tunable thresholds and constants live here (MVP_SPEC §9).

export const config = {
  camera: {
    width: 1280,
    height: 720,
    facingMode: 'user' as const,
  },
  scene: {
    fov: 50,
    near: 0.1,
    far: 100,
    cameraZ: 5,
  },
  fps: {
    // Window over which the FPS counter averages frame times (ms).
    sampleWindowMs: 500,
  },
  tracking: {
    numHands: 2,
    // EMA weight of the newest sample (MVP_SPEC §3.1: alpha ~0.5).
    smoothingAlpha: 0.5,
    // Run hand tracking every N rendered frames; auto-raised to 2 when FPS is low.
    trackingEveryNFrames: 1,
    lowFpsThreshold: 24,
    lowFpsDurationMs: 2000,
    minDetectionConfidence: 0.5,
    minPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    // Served from /public so the demo works offline.
    wasmPath: '/mediapipe/wasm',
    modelPath: '/mediapipe/hand_landmarker.task',
  },
  handToScene: {
    // Palm size (wrist -> middle MCP, normalized image units) at the reference depth.
    referenceHandSize: 0.18,
    // Scene depth (z) when the hand is at reference size; bigger hand -> closer (larger z).
    referenceZ: 0,
    depthGain: 3,
    minZ: -2,
    maxZ: 2,
  },
  gestures: {
    // Pinch: thumb tip <-> index tip distance divided by hand size (hysteresis).
    pinchClose: 0.35,
    pinchOpen: 0.5,
    // Wrist roll is measured relative to the roll at pinch start; ignore tiny changes.
    rollDeadzoneRad: 0.05,
    tiltDeadzoneRad: 0.05,
    // Press: fingertip pushes this far (scene units) past a button's front face.
    pressDepth: 0.15,
    // Press must release by this much before it can fire again.
    pressReleaseDepth: 0.05,
  },
  sim: {
    blinkIntervalMs: 500,
    resistorOhms: 220,
  },
};
