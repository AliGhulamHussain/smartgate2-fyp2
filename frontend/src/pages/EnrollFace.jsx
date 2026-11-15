import { useEffect, useRef, useState } from "react";
import { Camera, Trash2 } from "lucide-react";
import { api, useApi } from "../api";
import { detectFace, drawFaceFrame, faceDistance, loadFaceModels, startCamera, stopCamera } from "../face";
import { Button, ErrorNote, Modal, TONE_HEX, useToast } from "../ui";

const SAMPLES = 5;

// Face enrollment dialog. The webcam takes 5 samples automatically; every
// sample must be the same person as the first one. Only the 128 numbers per
// sample are sent to the server, never the video.
export default function EnrollFace({ employee, onClose, onSaved }) {
  const notify = useToast();
  const video = useRef(null);
  const overlay = useRef(null);
  const [phase, setPhase] = useState("starting");
  const [samples, setSamples] = useState([]);
  const [hint, setHint] = useState("Starting camera");
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);
  const existing = useApi(`/api/recognition/employees/${employee.id}/faces`);

  useEffect(() => {
    let stream;
    let stopped = false;
    let timer;
    const collected = [];

    async function loop() {
      if (stopped) return;
      const result = await detectFace(video.current, 416).catch(() => null);
      if (stopped) return;
      const v = video.current;
      const box = result?.detection.box;
      const bigEnough = box && box.width > v.videoWidth * 0.2;
      const steady = result && result.detection.score > 0.7;

      drawFaceFrame(overlay.current, v, box, bigEnough && steady ? TONE_HEX.accent : "rgba(255,255,255,0.6)");

      if (!result) setHint("Look straight at the camera");
      else if (!bigEnough) setHint("Move a little closer");
      else if (!steady) setHint("Hold still");
      else if (collected.length && faceDistance(collected[0], result.descriptor) > 0.6) setHint("Only one person, please");
      else {
        collected.push(Array.from(result.descriptor));
        setSamples([...collected]);
        setHint(collected.length < SAMPLES ? "Turn your head slightly" : "Captured");
        if (collected.length >= SAMPLES) {
          setPhase("ready");
          return;
        }
        timer = setTimeout(loop, 650);
        return;
      }
      timer = setTimeout(loop, 200);
    }

    (async () => {
      try {
        await loadFaceModels();
        if (stopped) return;
        stream = await startCamera(video.current);
        if (stopped) return stopCamera(stream);
        setPhase("capturing");
        loop();
      } catch (err) {
        console.error("Enrollment camera failed:", err);
        setError(new Error(err.name === "NotAllowedError" ? "Camera permission was denied." : "Could not start the camera or face models."));
        setPhase("error");
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      stopCamera(stream);
    };
  }, [attempt]);

  async function save() {
    setPhase("saving");
    setError(null);
    try {
      await api(`/api/recognition/employees/${employee.id}/faces`, { method: "PUT", body: { descriptors: samples } });
      notify(`${employee.full_name} can now be recognized`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
      setPhase("ready");
    }
  }

  async function remove() {
    try {
      await api(`/api/recognition/employees/${employee.id}/faces`, { method: "DELETE" });
      notify("Face data removed");
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  const progress = samples.length / SAMPLES;

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Enroll ${employee.full_name}`}
      description="Five samples are taken automatically. Only face descriptors are stored, never the video."
      footer={
        <>
          {existing.data?.samples > 0 && (
            <Button variant="danger" icon={Trash2} onClick={remove} className="mr-auto">Remove face data</Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          {phase === "ready" || phase === "saving" ? (
            <>
              <Button onClick={() => { setSamples([]); setError(null); setPhase("starting"); setAttempt((a) => a + 1); }}>Retake</Button>
              <Button variant="primary" onClick={save} loading={phase === "saving"}>Save enrollment</Button>
            </>
          ) : null}
        </>
      }
    >
      <div className="relative mx-auto aspect-[4/3] w-full overflow-hidden rounded-3xl bg-black/40 ring-1 ring-line">
        <video ref={video} muted playsInline className="size-full -scale-x-100 object-cover" />
        <canvas ref={overlay} className="pointer-events-none absolute inset-0 size-full -scale-x-100 object-cover" />
        {phase === "starting" && (
          <div className="absolute inset-0 grid place-items-center text-sm text-fg-2">
            <span className="flex items-center gap-2"><Camera className="size-4" aria-hidden /> Starting camera and face models</span>
          </div>
        )}
        <div className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-4 rounded-2xl bg-black/45 px-4 py-3 backdrop-blur-md">
          <p className="text-sm text-fg" aria-live="polite">{phase === "ready" ? "All samples captured" : hint}</p>
          <div className="flex items-center gap-2">
            <svg viewBox="0 0 36 36" className="size-9 -rotate-90" aria-hidden>
              <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="3" />
              <circle
                cx="18" cy="18" r="15" fill="none" stroke={TONE_HEX.accent} strokeWidth="3" strokeLinecap="round"
                strokeDasharray={`${progress * 94.2} 94.2`} style={{ transition: "stroke-dasharray 400ms cubic-bezier(0.16,1,0.3,1)" }}
              />
            </svg>
            <span className="tabular text-sm text-fg-2">{samples.length}/{SAMPLES}</span>
          </div>
        </div>
      </div>
      {existing.data?.samples > 0 && (
        <p className="mt-3 text-xs text-fg-3">Already enrolled with {existing.data.samples} samples. Saving replaces them.</p>
      )}
      {error && <div className="mt-4"><ErrorNote error={error} /></div>}
    </Modal>
  );
}
