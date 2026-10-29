// Pure helpers mapping normalized video landmarks to screen pixels and scene depth.

import { config } from '../config';

/**
 * Maps normalized video coords to screen pixels for a video drawn with `object-fit: cover`
 * (the video is cropped to fill the screen, so the mapping is not a plain scale).
 */
export function videoToScreen(
  x: number,
  y: number,
  videoW: number,
  videoH: number,
  screenW: number,
  screenH: number,
): { px: number; py: number } {
  const scale = Math.max(screenW / videoW, screenH / videoH);
  const dw = videoW * scale;
  const dh = videoH * scale;
  return { px: (screenW - dw) / 2 + x * dw, py: (screenH - dh) / 2 + y * dh };
}

/** Scene z from apparent palm size in the image: larger hand -> closer to the camera -> larger z. */
export function handDepthZ(palmSize: number): number {
  const m = config.handToScene;
  const z = m.referenceZ + m.depthGain * (palmSize / m.referenceHandSize - 1);
  return Math.min(m.maxZ, Math.max(m.minZ, z));
}
