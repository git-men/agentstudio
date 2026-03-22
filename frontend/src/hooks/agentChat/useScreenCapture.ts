import { useCallback } from 'react';

interface UseScreenCaptureProps {
  onCapture: (file: File) => void;
}

export const useScreenCapture = ({ onCapture }: UseScreenCaptureProps) => {
  const captureScreen = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' } as MediaTrackConstraints,
      });

      const track = stream.getVideoTracks()[0];
      const video = document.createElement('video');
      video.srcObject = stream;
      video.autoplay = true;

      await new Promise<void>((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve();
        };
      });

      // Wait a frame for the video to actually render
      await new Promise((resolve) => requestAnimationFrame(resolve));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        track.stop();
        return;
      }

      ctx.drawImage(video, 0, 0);
      track.stop();

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png')
      );

      if (blob) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = new File([blob], `screenshot-${timestamp}.png`, {
          type: 'image/png',
        });
        onCapture(file);
      }
    } catch (err) {
      if ((err as DOMException)?.name === 'NotAllowedError') {
        // User cancelled the screen picker — silently ignore
        return;
      }
      console.error('Screen capture failed:', err);
    }
  }, [onCapture]);

  const isSupported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getDisplayMedia;

  return { captureScreen, isSupported };
};
