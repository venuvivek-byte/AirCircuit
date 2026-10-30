// All tunable thresholds and constants live here (MVP_SPEC §9).

export const config = {
  camera: {
    width: 1280,
    height: 720,
    facingMode: 'user' as const,
    // Retry interval when the webcam is busy (used by another app) or missing.
    retryMs: 2000,
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
      // Sensors along the back, facing the user: bring your hand toward them from the front.
      ir: [-1.8, -2.1],
      ultrasonic: [-0.6, -2.1],
      sound: [0.6, -2.1],
      gas: [1.8, -2.1],
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
  controls: {
    // Scene-space placement of the Run / Stop / Reset buttons (above the workspace).
    y: 1.75,
    z: 0.3,
    spacing: 0.85,
    size: [0.75, 0.32, 0.15] as [number, number, number],
  },
  interaction: {
    // Screen-space radius for hovering / picking a pin.
    pinPickRadiusPx: 16,
    mouseRotateStepRad: Math.PI / 12,
    // Hand mode: hold the index fingertip on a toolbar button this long to spawn it.
    dwellSpawnMs: 2000,
    // Shorter dwell for the zoom toggle (nothing is created, so a mis-trigger is harmless).
    dwellZoomMs: 1500,
    // A hovered pin stays selected until the pointer leaves pinStickRadiusPx or another pin is
    // at least pinSwitchMarginPx closer, so hand tremor doesn't flick between neighbouring holes.
    pinStickRadiusPx: 24,
    pinSwitchMarginPx: 6,
    // Pinch a wire and hold within wireDetachMovePx for wireDetachMs: its nearest end unplugs into the hand.
    wireDetachMs: 2000,
    wireDetachMovePx: 30,
    // Scissors: the wire within this many screen px of the cut point is targeted.
    cutRadiusPx: 18,
  },
  zoom: {
    // Camera zoom factor when zoomed onto a part, and per-frame easing toward the target (0..1).
    factor: 2.2,
    easing: 0.15,
    // While holding a part with a fist: zoom = view zoom at grab * (palm size ratio) ^ gain, clamped.
    depth: { gain: 2, min: 0.6, max: 3.5 },
  },
  fps: {
    // Window over which the FPS counter averages frame times (ms).
    sampleWindowMs: 500,
  },
  tracking: {
    numHands: 2,
    // One Euro filter per landmark coordinate (Casiez et al. 2012): heavy smoothing while the
    // hand is still (no jitter), light smoothing while it moves fast (no drag lag).
    // minCutoff (Hz): lower = less jitter at rest. beta: higher = less lag when moving.
    oneEuro: { minCutoff: 1.0, beta: 20, dCutoff: 1.0 },
    // Keep a hand alive this long after MediaPipe drops it, so a one-frame miss doesn't drop a drag.
    handLostGraceMs: 250,
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
    // A pinch only releases after this many consecutive open frames (stops flicker drops mid-drag).
    pinchReleaseFrames: 3,
    // While the fingers open (ratio between pinchClose and pinchOpen) the pointer is frozen so the
    // release lands where the pinch was; after this many frames it's a loose drag and follows again.
    pinchFreezeMaxFrames: 10,
    // A pinch only starts after this many consecutive closed frames, with the index finger
    // reaching out (curl above pinchMinIndexCurl), so closing the hand into a fist never pinches.
    // A real pinch bends the index toward the thumb (curl ~0.85-1.0); a fist is ~0.7 or lower.
    pinchStartFrames: 2,
    pinchMinIndexCurl: 0.8,
    // Fist: every finger's curl (wrist->tip / wrist->PIP, 3D) below fistClose; opens when the
    // mean curl rises above fistOpen for fistReleaseFrames frames.
    fistClose: 1.0,
    fistOpen: 1.2,
    fistStartFrames: 2,
    fistReleaseFrames: 3,
    // Scissors (V sign): index + middle extended (curl above scissorExtended), ring + pinky curled
    // (below scissorCurled), held for scissorStartFrames. Gap = index tip <-> middle tip / hand size:
    // a snip is the gap rising above scissorOpen and then falling below scissorClose.
    scissorExtended: 1.15,
    scissorCurled: 1.05,
    scissorStartFrames: 2,
    scissorOpen: 0.4,
    scissorClose: 0.25,
    // Wrist roll is measured relative to the roll at pinch start; ignore tiny changes.
    rollDeadzoneRad: 0.05,
    tiltDeadzoneRad: 0.05,
    // Fist depth zoom: ignore palm-size changes within ±10% (log space) of the size at grab start.
    depthDeadzone: 0.1,
    // Press: fingertip pushes this far (scene units) past a button's front face.
    pressDepth: 0.15,
    // Press must release by this much before it can fire again.
    pressReleaseDepth: 0.05,
  },
  sensors: {
    // Scene units -> cm for the ultrasonic reading (the table is a stylised scale).
    cmPerUnit: 10,
    ultrasonicMaxCm: 200,
    // Half-angle of the ultrasonic beam, and the IR sensor's range (scene units).
    beamHalfAngleRad: 0.35,
    irRange: 1.0,
    irHalfWidth: 0.45,
    // Hold G to leak gas / V for noise: level change per second.
    gasRisePerSec: 0.6,
    gasFallPerSec: 0.15,
    // Microphone RMS -> 0..1 level.
    micGain: 8,
  },
  sim: {
    blinkIntervalMs: 500,
    resistorOhms: 220,
  },
};
