// Pure hand-landmark types (no MediaPipe / DOM imports), shared by the tracker and gesture logic.

/** MediaPipe-style landmark: x, y normalized to [0,1] image coords (already mirrored for display), z relative depth. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** 21 landmarks in MediaPipe order. */
export type HandLandmarks = Landmark[];

export interface TrackedHand {
  landmarks: HandLandmarks;
  handedness: 'Left' | 'Right';
  /** MediaPipe world landmarks (meters, hand-centred, x mirrored): true 3D, so pinch distance ignores hand orientation. */
  world?: HandLandmarks;
}

/** MediaPipe hand landmark indices. */
export const LM = {
  WRIST: 0,
  THUMB_CMC: 1, THUMB_MCP: 2, THUMB_IP: 3, THUMB_TIP: 4,
  INDEX_MCP: 5, INDEX_PIP: 6, INDEX_DIP: 7, INDEX_TIP: 8,
  MIDDLE_MCP: 9, MIDDLE_PIP: 10, MIDDLE_DIP: 11, MIDDLE_TIP: 12,
  RING_MCP: 13, RING_PIP: 14, RING_DIP: 15, RING_TIP: 16,
  PINKY_MCP: 17, PINKY_PIP: 18, PINKY_DIP: 19, PINKY_TIP: 20,
} as const;
