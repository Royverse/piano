// Camera hand tracking with MediaPipe. Frames are processed locally in the
// browser; nothing is recorded or sent.

const VERSION = '1.0.1';
const LIBRARY = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
const LOCAL_MODEL = new URL('../../models/hand_landmarker.task', import.meta.url).href;
const REMOTE_MODEL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

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
  if (typeof window !== 'undefined' && window.isSecureContext === false) {
    return 'Camera access requires HTTPS or localhost. Open this page over a secure connection, or conduct with your mouse.';
  }
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
      return error?.message?.includes('timed out')
        ? 'Hand tracking took too long to start. Check your connection and try again, or conduct with your mouse.'
        : 'Hand tracking couldn\'t load. Check your connection and try again, or conduct with your mouse.';
  }
}

let warmPromise = null;
let landmarkerInstance = null;

async function resolveModelPath() {
  try {
    const res = await fetch(LOCAL_MODEL, { method: 'HEAD' });
    if (res.ok) return LOCAL_MODEL;
  } catch { /* use remote fallback */ }
  return REMOTE_MODEL;
}

/** Preload MediaPipe and the model in the background so there's zero wait when requested. */
export function warmHands(onStatus) {
  if (landmarkerInstance) return Promise.resolve(landmarkerInstance);
  if (warmPromise) return warmPromise;

  warmPromise = (async () => {
    onStatus?.('Loading vision engine…');
    const { FilesetResolver, HandLandmarker } = await import(`${LIBRARY}/vision_bundle.mjs`);
    const fileset = await FilesetResolver.forVisionTasks(`${LIBRARY}/wasm`);

    onStatus?.('Loading hand model…');
    const modelAssetPath = await resolveModelPath();

    onStatus?.('Starting hand tracker…');
    const options = (delegate) => ({
      baseOptions: { modelAssetPath, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    const initLandmarker = (delegate, timeoutMs = 8000) =>
      Promise.race([
        HandLandmarker.createFromOptions(fileset, options(delegate)),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`${delegate} startup timed out`)), timeoutMs)),
      ]);

    // Use CPU by default: avoids 50s ANGLE WebGL shader compile freezes and runs at 60+ FPS via XNNPACK SIMD
    try {
      landmarkerInstance = await initLandmarker('CPU', 8000);
    } catch (cpuError) {
      console.warn('CPU tracker init failed, trying GPU:', cpuError);
      landmarkerInstance = await initLandmarker('GPU', 8000);
    }
    return landmarkerInstance;
  })().catch((err) => {
    warmPromise = null;
    throw err;
  });

  return warmPromise;
}

export async function startHands(video, { onFrame, onStatus }) {
  if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('No camera API'), { name: 'NotFoundError' });

  // Start preloading tracker concurrently with camera permission prompt
  const trackerPromise = warmHands(onStatus);

  onStatus?.('Asking for camera access…');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' },
    audio: false,
  });

  video.srcObject = stream;
  await new Promise((resolve) => {
    if (video.readyState >= 1) resolve();
    else {
      video.onloadedmetadata = () => resolve();
      setTimeout(resolve, 2000);
    }
  });

  try {
    await video.play();
  } catch (err) {
    console.warn('Video play warning:', err);
  }

  let landmarker;
  try {
    landmarker = await trackerPromise;
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
    },
  };
}
