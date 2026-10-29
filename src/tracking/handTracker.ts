import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import { config } from '../config';
import type { TrackedHand } from './types';

/** Thin wrapper over MediaPipe HandLandmarker. Returns landmarks mirrored to match the mirrored video. */
export class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private lastTimestamp = -1;
  private lastVideoTime = -1;
  delegate: 'GPU' | 'CPU' = 'GPU';

  async init(): Promise<void> {
    const t = config.tracking;
    const fileset = await FilesetResolver.forVisionTasks(t.wasmPath);
    const create = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: t.modelPath, delegate },
        runningMode: 'VIDEO',
        numHands: t.numHands,
        minHandDetectionConfidence: t.minDetectionConfidence,
        minHandPresenceConfidence: t.minPresenceConfidence,
        minTrackingConfidence: t.minTrackingConfidence,
      });
    try {
      this.landmarker = await create('GPU');
    } catch (err) {
      console.warn('GPU delegate failed, falling back to CPU:', err);
      this.delegate = 'CPU';
      this.landmarker = await create('CPU');
    }
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /** Returns null when the video has no new frame since the last call (render loop outpaces the camera). */
  detect(video: HTMLVideoElement, now: number): TrackedHand[] | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return [];
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    // MediaPipe requires strictly increasing timestamps.
    const ts = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const result = this.landmarker.detectForVideo(video, ts);
    return result.landmarks.map((lms, i) => ({
      landmarks: lms.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
      handedness: (result.handedness[i]?.[0]?.categoryName as 'Left' | 'Right') ?? 'Right',
      world: result.worldLandmarks[i]?.map((p) => ({ x: -p.x, y: p.y, z: p.z })),
    }));
  }
}
