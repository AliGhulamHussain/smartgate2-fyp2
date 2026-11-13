// Full-screen gate kiosk. All face processing runs in the browser with
// @vladmandic/face-api; the Recognition Service receives a descriptor, the
// blink result and (used only for unknown faces) a small snapshot.
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft, CheckCircle2, Clock3, DoorOpen, Eye, Hand, LogOut, Maximize, Minimize, ScanFace, ShieldAlert, UserRound, XCircle,
} from "lucide-react";
import { api, useApi } from "../api";
import { navigate } from "../router";
import {
  averageDescriptor, detectFace, drawFaceFrame, eyeAspectRatio, faceDistance, faceSnapshot, loadFaceModels, startCamera, stopCamera,
} from "../face";
import { Empty, Panel, Skeleton, Spinner, TONE_HEX, cx, fmtMinutes, label } from "../ui";

export default function Kiosk({ gateId }) {
  return gateId ? <Scanner gateId={gateId} /> : <GatePicker />;
}

function GatePicker() {
  const { data, loading } = useApi("/api/attendance/gates");
  const gates = (data?.gates ?? []).filter((g) => g.status === "active");

  return (
    <main className="relative z-10 mx-auto flex min-h-dvh w-full max-w-5xl flex-col justify-center overflow-x-hidden px-6 py-16">
      <a href="#/gates" className="mb-10 inline-flex w-fit items-center gap-2 text-sm text-fg-3 transition-colors hover:text-fg">
        <ArrowLeft className="size-4" aria-hidden /> Back to dashboard
      </a>
      <h1 className="reveal text-[clamp(2rem,4vw,3.5rem)] font-semibold leading-[1.05] tracking-[-0.04em]">
        Which gate is this screen at?
      </h1>
      <p className="reveal mt-3 max-w-xl text-fg-3" style={{ "--i": 1 }}>
        The gate decides whether people are checked in or out. You can switch later from the kiosk.
      </p>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-36" />)}
        {gates.map((gate, i) => (
          <a key={gate.id} href={`#/kiosk/${gate.id}`} className="glass reveal group rounded-[28px] p-6 transition-transform duration-500 ease-out hover:-translate-y-1" style={{ "--i": i + 2 }}>
            <DoorOpen className="size-6 text-accent transition-transform duration-500 ease-out group-hover:scale-110" aria-hidden />
            <p className="mt-6 text-xl font-semibold tracking-tight">{gate.name}</p>
            <p className="mt-1 text-sm text-fg-3">{gate.direction === "both" ? "Entry and exit" : `${label(gate.direction)} only`}</p>
          </a>
        ))}
      </div>
      {!loading && gates.length === 0 && (
        <Panel className="mt-6">
          <Empty icon={DoorOpen} title="No active gates">An administrator needs to add a gate first.</Empty>
        </Panel>
      )}
    </main>
  );
}

const PROMPTS = {
  starting: { icon: ScanFace, text: "Starting camera" },
  idle: { icon: UserRound, text: "Step in front of the camera" },
  closer: { icon: UserRound, text: "Come a little closer" },
  hold: { icon: Hand, text: "Hold still" },
  blink: { icon: Eye, text: "Blink once" },
  checking: { icon: ScanFace, text: "Checking" },
};

const SAME_PERSON = 0.45;     // descriptor distance between consecutive frames
const FRAMES_NEEDED = 3;      // consecutive frames before identifying
const RESULT_MS = 3800;       // how long a result stays on screen
const IGNORE_SAME_MS = 9000;  // ignore the person just identified while they walk through

function Scanner({ gateId }) {
  const video = useRef(null);
  const overlay = useRef(null);
  const [stage, setStage] = useState("starting");
  const [result, setResult] = useState(null);
  const [fatal, setFatal] = useState(null);
  const [fullscreen, setFullscreen] = useState(Boolean(document.fullscreenElement));
  const gate = useApi(`/api/attendance/gates/${gateId}`);
  const settings = useApi("/api/recognition/settings");
  const liveness = settings.data?.settings.liveness_required ?? true;
  const livenessRef = useRef(liveness);
  livenessRef.current = liveness;

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    let stream;
    let stopped = false;
    let timer;
    let resultTimer;
    const s = { frames: [], earOpen: 0, eyesClosed: false, blinked: false, busy: false, pausedUntil: 0, last: null };

    const resetTrack = () => {
      s.frames = [];
      s.earOpen = 0;
      s.eyesClosed = false;
      s.blinked = false;
    };
    const schedule = (ms) => {
      if (!stopped) timer = setTimeout(tick, ms);
    };

    async function identify(box) {
      s.busy = true;
      setStage("checking");
      const descriptor = averageDescriptor(s.frames.slice(-FRAMES_NEEDED));
      const snapshot = faceSnapshot(video.current, box);
      let outcome;
      try {
        outcome = await api("/api/recognition/identify", {
          method: "POST",
          body: { gate_id: gateId, descriptor, liveness_passed: s.blinked, snapshot },
        });
      } catch (error) {
        outcome = { error: error.message };
      }
      if (stopped) return;
      s.last = { descriptor, until: performance.now() + IGNORE_SAME_MS };
      s.pausedUntil = performance.now() + 1200;
      s.busy = false;
      resetTrack();
      setResult(outcome);
      clearTimeout(resultTimer);
      resultTimer = setTimeout(() => setResult(null), RESULT_MS);
    }

    async function tick() {
      if (stopped) return;
      const v = video.current;
      if (s.busy || performance.now() < s.pausedUntil) return schedule(150);

      const face = await detectFace(v, 320).catch(() => null);
      if (stopped) return;
      const box = face?.detection.box;

      if (!face) {
        resetTrack();
        drawFaceFrame(overlay.current, v, null);
        setStage("idle");
        return schedule(160);
      }
      if (box.width < v.videoWidth * 0.14) {
        resetTrack();
        drawFaceFrame(overlay.current, v, box, "rgba(255,255,255,0.55)");
        setStage("closer");
        return schedule(140);
      }

      // The person who was just identified is walking through: leave them be.
      if (s.last && performance.now() < s.last.until && faceDistance(s.last.descriptor, face.descriptor) < 0.5) {
        drawFaceFrame(overlay.current, v, box, TONE_HEX.ok);
        return schedule(200);
      }

      // Consecutive frames must show the same person.
      const previous = s.frames[s.frames.length - 1];
      if (previous && faceDistance(previous, face.descriptor) > SAME_PERSON) resetTrack();
      s.frames.push(Array.from(face.descriptor));
      if (s.frames.length > 6) s.frames.shift();

      // Blink: eye aspect ratio falls well below this person's open-eye level, then recovers.
      const ear = eyeAspectRatio(face.landmarks);
      s.earOpen = Math.max(ear, s.earOpen * 0.985);
      if (ear < s.earOpen * 0.7) s.eyesClosed = true;
      else if (s.eyesClosed && ear > s.earOpen * 0.85) {
        s.eyesClosed = false;
        s.blinked = true;
      }

      const steady = s.frames.length >= FRAMES_NEEDED;
      const ready = steady && (s.blinked || !livenessRef.current);
      drawFaceFrame(overlay.current, v, box, ready ? TONE_HEX.accent : "rgba(255,255,255,0.85)");

      if (ready) {
        identify(box);
        return schedule(150);
      }
      setStage(steady ? "blink" : "hold");
      schedule(80);
    }

    (async () => {
      try {
        await loadFaceModels();
        if (stopped) return;
        stream = await startCamera(video.current);
        if (stopped) return stopCamera(stream);
        setStage("idle");
        tick();
      } catch (error) {
        console.error("Kiosk start failed:", error);
        setFatal(error.name === "NotAllowedError" ? "Camera permission was denied. Allow camera access and reload." : "The camera or face models could not be started.");
      }
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(resultTimer);
      stopCamera(stream);
    };
  }, [gateId]);

  const prompt = PROMPTS[stage] ?? PROMPTS.idle;
  const PromptIcon = prompt.icon;

  return (
    <main className="fixed inset-0 z-10 overflow-hidden bg-ink">
      <video ref={video} muted playsInline className="absolute inset-0 size-full -scale-x-100 object-cover" />
      <canvas ref={overlay} className="pointer-events-none absolute inset-0 size-full -scale-x-100 object-cover" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgb(11_13_16/0.85)_100%)]" aria-hidden />

      <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-5 sm:p-8">
        <div className="glass glass-strong flex items-center gap-3 rounded-full py-2 pl-2 pr-5">
          <span className="flex size-10 items-center justify-center rounded-full bg-accent text-accent-ink">
            <ScanFace className="size-5" aria-hidden />
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold">{gate.data?.gate.name ?? "Gate"}</p>
            <p className="text-xs text-fg-3">{gate.data ? (gate.data.gate.direction === "both" ? "Entry and exit" : `${label(gate.data.gate.direction)} only`) : " "}</p>
          </div>
        </div>
        <Clock />
        <div className="glass glass-strong flex items-center gap-1 rounded-full p-1.5">
          <button
            type="button"
            onClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-white/10 hover:text-fg"
          >
            {fullscreen ? <Minimize className="size-[18px]" aria-hidden /> : <Maximize className="size-[18px]" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => {
              if (document.fullscreenElement) document.exitFullscreen();
              navigate("/gates");
            }}
            aria-label="Leave kiosk"
            className="inline-flex size-10 cursor-pointer items-center justify-center rounded-full text-fg-2 transition-colors hover:bg-white/10 hover:text-fg"
          >
            <LogOut className="size-[18px]" aria-hidden />
          </button>
        </div>
      </header>

      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 p-6 pb-10 sm:pb-14">
        {fatal ? (
          <ResultCard tone="bad" icon={XCircle} title="Kiosk unavailable" subtitle={fatal} />
        ) : result ? (
          <Outcome result={result} />
        ) : (
          <div key={stage} className="glass glass-strong reveal flex items-center gap-3 rounded-full px-6 py-4 text-lg font-medium" aria-live="polite">
            {stage === "checking" || stage === "starting" ? <Spinner className="size-5 text-accent" /> : <PromptIcon className="size-5 text-accent" aria-hidden />}
            {prompt.text}
          </div>
        )}
        {liveness && !result && !fatal && (
          <p className="text-xs text-fg-3">A quick blink confirms a real person is at the gate.</p>
        )}
      </div>
    </main>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="hidden text-center md:block">
      <p className="tabular text-5xl font-semibold tracking-[-0.04em] [text-shadow:0_2px_24px_rgb(0_0_0/0.5)]">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </p>
      <p className="mt-1 text-sm text-fg-2">{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}</p>
    </div>
  );
}

function Outcome({ result }) {
  if (result.error) {
    return <ResultCard tone="bad" icon={XCircle} title="Could not check you in" subtitle={result.error} />;
  }
  if (!result.matched) {
    return (
      <ResultCard
        tone="warn"
        icon={ShieldAlert}
        title={result.reason === "no_enrolled_faces" ? "No faces enrolled yet" : "We could not recognize you"}
        subtitle={result.alert_queued ? "Please see reception. Security has been notified." : "Please see reception, or try again facing the camera."}
      />
    );
  }

  const name = result.employee?.full_name ?? "";
  const a = result.attendance;
  if (!a.recorded) {
    const why = { cooldown: "You were just recorded.", already_inside: "You are already checked in.", not_inside: "You are not checked in yet." };
    return <ResultCard tone="info" icon={Clock3} title={name} subtitle={why[a.reason] ?? "Nothing to record."} />;
  }

  const time = new Date(a.logged_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (a.action === "check_in") {
    return (
      <ResultCard
        tone={a.status === "late" ? "warn" : "ok"}
        icon={CheckCircle2}
        title={`Welcome, ${name.split(" ")[0]}`}
        subtitle={a.status === "late" ? `Checked in at ${time} · ${fmtMinutes(a.late_by_minutes)} late` : `Checked in at ${time}`}
      />
    );
  }
  return (
    <ResultCard
      tone="info"
      icon={LogOut}
      title={`Goodbye, ${name.split(" ")[0]}`}
      subtitle={a.status === "early_leave" ? `Checked out at ${time} · before end of day` : `Checked out at ${time}`}
    />
  );
}

const RESULT_TONE = {
  ok: "bg-ok/15 text-ok ring-ok/30",
  warn: "bg-warn/15 text-warn ring-warn/30",
  bad: "bg-bad/15 text-bad ring-bad/30",
  info: "bg-info/15 text-info ring-info/30",
};

function ResultCard({ tone, icon: Icon, title, subtitle }) {
  return (
    <div role="status" className="glass glass-strong reveal flex w-full max-w-xl items-center gap-5 rounded-[32px] p-5 pr-8 sm:p-6">
      <span className={cx("flex size-16 shrink-0 items-center justify-center rounded-3xl ring-1 ring-inset", RESULT_TONE[tone])}>
        <Icon className="size-8" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{title}</p>
        <p className="mt-1 text-[15px] text-fg-2">{subtitle}</p>
      </div>
    </div>
  );
}
