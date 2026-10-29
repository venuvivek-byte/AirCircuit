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
  workspace: {
    // Tilt of the virtual table toward the camera so component tops are visible.
    tiltRad: 0.95,
    y: 0.1,
    scale: 0.8,
  },
  components: {
    breadboardPitch: 0.15,
    breadboardThickness: 0.12,
    ledLegSpacing: 0.15,
    resistorLegSpacing: 0.6,
    // Workspace-local (x, z) spawn spot per kind; repeated spawns are offset diagonally.
    spawnPositions: {
      breadboard: [0, -0.3],
      'arduino-uno': [-3.0, 0],
      esp32: [2.6, 0],
      led: [-0.6, 1.5],
      resistor: [0.6, 1.5],
    } as Record<string, [number, number]>,
    spawnOffset: 0.25,
    labelScale: 0.11,
  },
  wires: {
    radius: 0.018,
    baseLift: 0.15,
    liftPerUnit: 0.2,
  },
  snapping: {
    // Max distance (breadboard-local units) from a leg to the nearest hole for a snap.
    snapRadius: 0.25,
    // After aligning, every leg must be this close to a hole.
    legTolerance: 0.03,
  },
  interaction: {
    // Screen-space radius for hovering / picking a pin.
    pinPickRadiusPx: 16,
    mouseRotateStepRad: Math.PI / 12,
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
