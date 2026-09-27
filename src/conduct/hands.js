// Camera hand tracking with MediaPipe, loaded only when someone chooses the
// camera. Frames are processed in the browser; nothing is recorded or sent.

const VERSION = '1.0.1';
const LIBRARY = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// Bones between MediaPipe's 21 hand landmarks, for drawing.
export const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [0, 17], [17, 18], [18, 19], [19, 20],
];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// One hand, in screen terms: mirrored like a mirror, with the tip of the
// index finger as the baton, and how open the hand is.
function readHand(landmarks) {
  const points = landmarks.map((p) => ({ x: 1 - p.x, y: p.y }));
  const wrist = points[0] ?? { x: 0.5, y: 0.5 };
  const palm = (points[9] ? dist(wrist, points[9]) : null) || 0.1;
  const reach = [8, 12, 16, 20].reduce((sum, i) => sum + (points[i] ? dist(wrist, points[i]) : 0), 0) / 4 / palm;
  return {
    x: points[8]?.x ?? 0.5,
    y: points[8]?.y ?? 0.5,
    open: Math.min(1, Math.max(0, (reach - 1.05) / 0.8)),
    points,
  };
}

/** Why the camera couldn't start, in words someone can act on. */
export function cameraProblem(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The camera is blocked for this page. Allow it in your browser\'s site settings, or conduct with your mouse.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Conduct with your mouse or finger instead.';
    case 'NotReadableError':
      return 'Another app is using the camera. Close it and try again, or conduct with your mouse.';
    default:
      return 'Hand tracking couldn\'t load. Check your connection and try again, or conduct with your mouse.';
  }
}

export async function startHands(video, { onFrame, onStatus }) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('No camera API'), { name: 'NotFoundError' });
  onStatus?.('Asking for the camera…');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  let landmarker;
  try {
    onStatus?.('Loading hand tracking…');
    const { FilesetResolver, HandLandmarker } = await import(`${LIBRARY}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${LIBRARY}/wasm`);
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
  } catch (error) {
    stream.getTracks().forEach((track) => track.stop());
    throw error;
  }

  let running = true;
  let lastTime = -1;
  const loop = () => {
    if (!running) return;
    if (video.readyState >= 2 && video.videoWidth > 0 && video.currentTime !== lastTime) {
      lastTime = video.currentTime;
      const t = performance.now();
      try {
        const result = landmarker.detectForVideo(video, t);
        if (result?.landmarks) {
          onFrame({ t, hands: result.landmarks.map(readHand) });
        }
      } catch (err) {
        // Continue tracking smoothly even if a single video frame is malformed
        console.warn('Hand tracking frame skipped:', err);
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  return {
    stop() {
      running = false;
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      landmarker.close();
    },
  };
}
