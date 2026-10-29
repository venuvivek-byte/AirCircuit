import { config } from '../config';

/** Starts the webcam stream on the given video element and resolves once frames are available. */
export async function startWebcam(video: HTMLVideoElement): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('getUserMedia is not supported in this browser.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      width: { ideal: config.camera.width },
      height: { ideal: config.camera.height },
      facingMode: config.camera.facingMode,
    },
  });
  video.srcObject = stream;
  await new Promise<void>((resolve) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) resolve();
    else video.addEventListener('loadedmetadata', () => resolve(), { once: true });
  });
  await video.play();
}
