// Browser-side face processing with @vladmandic/face-api. Images never leave
// the device for matching; only 128-number descriptors (and, for unknown
// faces, one small JPEG) are sent to the Recognition Service.
import * as faceapi from "@vladmandic/face-api";

let loading = null;

export function loadFaceModels() {
  loading ??= (async () => {
    await faceapi.tf.setBackend("webgl").catch(() => faceapi.tf.setBackend("cpu"));
    await faceapi.tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri("/models"),
      faceapi.nets.faceLandmark68Net.loadFromUri("/models"),
      faceapi.nets.faceRecognitionNet.loadFromUri("/models"),
    ]);
    // Warm up: the first run compiles GPU shaders and can take seconds.
    // Doing it here keeps that pause on the "starting" screen instead of
    // freezing the live camera view later.
    const blank = document.createElement("canvas");
    blank.width = blank.height = 160;
    await faceapi.detectSingleFace(blank, new faceapi.TinyFaceDetectorOptions({ inputSize: 160 }));
    await faceapi.nets.faceLandmark68Net.detectLandmarks(blank);
    await faceapi.computeFaceDescriptor(blank);
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

// One face with landmarks and descriptor, or undefined. face-api returns a
// thenable task, not a Promise; `async` turns it into a real Promise so
// callers can use .catch().
export async function detectFace(video, inputSize = 320) {
  return await faceapi
    .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();
}

export const faceDistance = (a, b) => faceapi.euclideanDistance(a, b);

export function averageDescriptor(descriptors) {
  const sum = new Array(128).fill(0);
  for (const d of descriptors) for (let i = 0; i < 128; i++) sum[i] += d[i];
  return sum.map((value) => value / descriptors.length);
}

const point = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Eye aspect ratio: drops sharply while the eyes are closed. Used for the
// blink liveness check (a printed photo cannot blink).
export function eyeAspectRatio(landmarks) {
  const ear = (e) => (point(e[1], e[5]) + point(e[2], e[4])) / (2 * point(e[0], e[3]));
  return (ear(landmarks.getLeftEye()) + ear(landmarks.getRightEye())) / 2;
}

// Small padded JPEG crop of the face for unknown-face alerts (kept under
// the service's 200 KB limit).
export function faceSnapshot(video, box, size = 256) {
  const pad = box.width * 0.35;
  const sx = Math.max(0, box.x - pad);
  const sy = Math.max(0, box.y - pad);
  const sw = Math.min(video.videoWidth - sx, box.width + pad * 2);
  const sh = Math.min(video.videoHeight - sy, box.height + pad * 2);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = Math.round((size * sh) / sw);
  canvas.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

export async function startCamera(video) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
    audio: false,
  });
  try {
    video.srcObject = stream;
    await video.play();
    return stream;
  } catch (error) {
    stopCamera(stream);
    throw error;
  }
}

export function stopCamera(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

// Draws corner brackets around the face on an overlay canvas sized to the
// video. `tone` is a CSS color.
export function drawFaceFrame(canvas, video, box, tone) {
  const ctx = canvas.getContext("2d");
  if (canvas.width !== video.videoWidth) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!box) return;

  const { x, y, width: w, height: h } = box;
  const len = Math.min(w, h) * 0.22;
  ctx.strokeStyle = tone;
  ctx.lineWidth = Math.max(3, w * 0.012);
  ctx.lineCap = "round";
  ctx.shadowColor = tone;
  ctx.shadowBlur = 18;
  ctx.beginPath();
  for (const [cx, cy, dx, dy] of [
    [x, y, 1, 1],
    [x + w, y, -1, 1],
    [x, y + h, 1, -1],
    [x + w, y + h, -1, -1],
  ]) {
    ctx.moveTo(cx, cy + dy * len);
    ctx.lineTo(cx, cy);
    ctx.lineTo(cx + dx * len, cy);
  }
  ctx.stroke();
}
