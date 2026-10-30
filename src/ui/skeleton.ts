import { HandLandmarker } from '@mediapipe/tasks-vision';
import { palmCenter } from '../tracking/gestures';
import { LM, type TrackedHand } from '../tracking/types';
import type { Grip } from '../scene/interaction';

const BONES = HandLandmarker.HAND_CONNECTIONS;
const COLORS: Record<'none' | 'scissors' | Grip, string> = {
  none: '#ffd23f',
  pinch: '#3dff7a',
  fist: '#ff8a3d',
  scissors: '#ff4d6d',
};

/** 2D overlay that draws each tracked hand as a skeleton (bones + joints) over the video. */
export class SkeletonOverlay {
  private ctx: CanvasRenderingContext2D;
  /** Focus mode (black backdrop): thicker, glowing bones so the hand reads without the video. */
  glow = false;

  constructor(
    private canvas: HTMLCanvasElement,
    /** Normalized (mirrored) landmark -> screen px, matching the cover-fitted video. */
    private toScreen: (x: number, y: number) => { px: number; py: number },
  ) {
    this.ctx = canvas.getContext('2d')!;
  }

  /** `scissors`: the primary hand's cut point while in the scissor pose. */
  draw(hands: TrackedHand[], grips: Array<Grip | null>, scissors: { px: number; py: number; open: boolean } | null = null): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr);
    const h = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    hands.forEach((hand, i) => {
      const grip = grips[i] ?? null;
      const cutting = i === 0 && scissors !== null;
      const color = COLORS[cutting ? 'scissors' : (grip ?? 'none')];
      const pts = hand.landmarks.map((p) => this.toScreen(p.x, p.y));

      ctx.lineCap = 'round';
      ctx.lineWidth = this.glow ? 6 : 4;
      ctx.strokeStyle = this.glow ? 'rgba(235,245,255,0.95)' : 'rgba(255,255,255,0.75)';
      ctx.shadowColor = color;
      ctx.shadowBlur = this.glow ? 18 : 0;
      ctx.beginPath();
      for (const { start, end } of BONES) {
        ctx.moveTo(pts[start].px, pts[start].py);
        ctx.lineTo(pts[end].px, pts[end].py);
      }
      ctx.stroke();

      ctx.fillStyle = color;
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.px, p.py, this.glow ? 5.5 : 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.shadowBlur = 0;

      // Grab anchor (palm centre) and wiring anchor (pinch point) markers.
      const palm = palmCenter(hand.landmarks);
      const c = this.toScreen(palm.x, palm.y);
      ctx.lineWidth = grip === 'fist' ? 5 : 2;
      ctx.strokeStyle = grip === 'fist' ? COLORS.fist : 'rgba(255,138,61,0.6)';
      ctx.beginPath();
      ctx.arc(c.px, c.py, 16, 0, Math.PI * 2);
      ctx.stroke();

      const t = pts[LM.THUMB_TIP];
      const f = pts[LM.INDEX_TIP];
      ctx.fillStyle = grip === 'pinch' ? COLORS.pinch : 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc((t.px + f.px) / 2, (t.py + f.py) / 2, grip === 'pinch' ? 8 : 5, 0, Math.PI * 2);
      ctx.fill();

      // Scissors cut point: a red cross-hair between the index and middle fingertips.
      if (cutting) {
        const r = scissors.open ? 12 : 8;
        ctx.strokeStyle = COLORS.scissors;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(scissors.px - r, scissors.py);
        ctx.lineTo(scissors.px + r, scissors.py);
        ctx.moveTo(scissors.px, scissors.py - r);
        ctx.lineTo(scissors.px, scissors.py + r);
        ctx.stroke();
      }
    });
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
