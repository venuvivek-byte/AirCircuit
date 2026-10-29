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
};
