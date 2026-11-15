import { ArrowUpRight, Clock3, DoorOpen, LogIn, LogOut, ShieldAlert, UserCheck, UserX, Users } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { query, useApi } from "../api";
import { useAuth } from "../auth";
import { fmtTime, label, timeAgo } from "../format";
import { navigate } from "../router";
import Snapshot from "../snapshot";
import { Avatar, Badge, Button, Empty, ErrorNote, PageHeader, Panel, Skeleton, TONE_HEX, cx } from "../ui";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// The home page: today's numbers, a 7-day chart, who is inside, recent
// check-ins and new unknown faces. Each part refreshes on its own timer.
export default function Overview() {
  const { user, can } = useAuth();
  const stats = useApi("/api/attendance/stats", { refreshMs: 30000 });
  const presence = useApi("/api/attendance/presence", { refreshMs: 15000 });
  const logs = useApi(`/api/attendance/logs${query({ limit: 6 })}`, { refreshMs: 15000 });
  const alerts = useApi(can("alerts") ? `/api/alerts/unknown-faces${query({ status: "new", limit: 4 })}` : null, { refreshMs: 30000 });

  const firstName = user.full_name.split(" ")[0];
  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  // 409 = no attendance policy yet, so there is nothing to report.
  if (stats.error?.status === 409) {
    return (
      <>
        <PageHeader title={`${greeting()}, ${firstName}`} description={today} />
        <Panel className="reveal p-2">
          <Empty
            icon={Clock3}
            title="Set your working hours first"
            action={user.role === "org_admin" && <Button variant="primary" onClick={() => navigate("/settings")}>Open settings</Button>}
          >
            SmartGate needs the attendance policy (timezone, start time, grace minutes and working days) before it can
            record or report attendance.
          </Empty>
        </Panel>
      </>
    );
  }

  const s = stats.data;
  const tiles = [
    { label: "Inside now", value: s?.inside_now, icon: Users, tone: "info", foot: s ? `of ${s.active_employees} active` : "" },
    { label: "On time", value: s?.today.present, icon: UserCheck, tone: "ok", foot: "arrived within grace" },
    { label: "Late", value: s?.today.late, icon: Clock3, tone: "warn", foot: "after grace period" },
    {
      label: "Absent",
      value: s?.today.working_day ? s?.today.absent : "—",
      icon: UserX,
      tone: "bad",
      foot: s?.today.working_day === false ? "not a working day" : "no check-in yet",
    },
  ];

  return (
    <>
      <PageHeader title={`${greeting()}, ${firstName}`} description={today} />
      <ErrorNote error={stats.error} onRetry={stats.reload} />

      <div className="grid grid-flow-dense grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {tiles.map((tile, i) => (
          <StatTile key={tile.label} {...tile} index={i} loading={stats.loading} />
        ))}

        <Panel className="reveal flex min-h-[360px] flex-col p-6 col-span-2 lg:col-span-3 lg:row-span-2" style={{ "--i": 4 }}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-[15px] font-semibold">Last 7 days</h2>
              <p className="mt-0.5 text-sm text-fg-3">Daily arrivals by outcome</p>
            </div>
            <Legend />
          </div>
          <div className="mt-6 min-h-[260px] flex-1">
            {s ? <TrendChart data={s.trend} /> : <Skeleton className="size-full" />}
          </div>
        </Panel>

        <Panel className="reveal flex flex-col p-6 col-span-2 lg:col-span-1 lg:row-span-2" style={{ "--i": 5 }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Inside now</h2>
            <a href="#/presence" className="flex items-center gap-1 text-[13px] text-fg-3 transition-colors hover:text-fg">
              All <ArrowUpRight className="size-3.5" aria-hidden />
            </a>
          </div>
          <div className="mt-4 flex-1 space-y-1 overflow-y-auto">
            {presence.loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
            {presence.data?.employees.length === 0 && <Empty icon={DoorOpen} title="Nobody inside">Check-ins appear here live.</Empty>}
            {presence.data?.employees.slice(0, 8).map((person) => (
              <div key={person.id} className="flex items-center gap-3 rounded-2xl px-2 py-2 transition-colors hover:bg-white/[0.04]">
                <Avatar name={person.full_name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{person.full_name}</p>
                  <p className="truncate text-xs text-fg-3">{person.gate_name ?? "—"} · {fmtTime(person.checked_in_at)}</p>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel className={cx("reveal col-span-2 p-6", can("alerts") ? "lg:col-span-2" : "lg:col-span-4")} style={{ "--i": 6 }}>
          <div className="flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">Recent activity</h2>
            {can("attendance") && (
              <a href="#/attendance" className="flex items-center gap-1 text-[13px] text-fg-3 transition-colors hover:text-fg">
                History <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            )}
          </div>
          <ul className="mt-4 space-y-1">
            {logs.loading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-11" />)}
            {logs.data?.logs.length === 0 && <Empty title="No punches yet">Recognized faces at the gate show up here.</Empty>}
            {logs.data?.logs.map((log) => (
              <li key={log.id} className="flex items-center gap-3 rounded-2xl px-2 py-2.5">
                <span className={cx("flex size-8 items-center justify-center rounded-full", log.action === "check_in" ? "bg-ok/10 text-ok" : "bg-info/10 text-info")}>
                  {log.action === "check_in" ? <LogIn className="size-4" aria-hidden /> : <LogOut className="size-4" aria-hidden />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-fg">
                    <span className="font-medium">{log.full_name}</span>
                    <span className="text-fg-3"> {log.action === "check_in" ? "checked in" : "checked out"} at {log.gate_name ?? "a gate"}</span>
                  </p>
                </div>
                {log.status !== "normal" && log.status !== "on_time" && <Badge>{log.status}</Badge>}
                <span className="tabular w-16 shrink-0 text-right text-xs text-fg-3">{timeAgo(log.logged_at)}</span>
              </li>
            ))}
          </ul>
        </Panel>

        {can("alerts") && (
          <Panel className="reveal col-span-2 p-6" style={{ "--i": 7 }}>
            <div className="flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[15px] font-semibold">
                Unknown faces
                {alerts.data?.counts.new > 0 && <Badge tone="warn" dot={false}>{alerts.data.counts.new} new</Badge>}
              </h2>
              <a href="#/alerts" className="flex items-center gap-1 text-[13px] text-fg-3 transition-colors hover:text-fg">
                Review <ArrowUpRight className="size-3.5" aria-hidden />
              </a>
            </div>
            {alerts.data?.unknown_faces.length === 0 ? (
              <Empty icon={ShieldAlert} title="All clear">No unreviewed visitors.</Empty>
            ) : (
              <div className="mt-4 grid grid-cols-4 gap-3">
                {(alerts.data?.unknown_faces ?? []).map((face) => (
                  <a key={face.id} href="#/alerts" className="group block">
                    <Snapshot url={face.snapshot_url} alt="Unknown visitor" className="aspect-square rounded-2xl ring-1 ring-line" />
                    <p className="mt-1.5 truncate text-xs text-fg-3">{timeAgo(face.captured_at)}</p>
                  </a>
                ))}
                {alerts.loading && [0, 1, 2, 3].map((i) => <Skeleton key={i} className="aspect-square" />)}
              </div>
            )}
          </Panel>
        )}
      </div>
    </>
  );
}

function StatTile({ label: text, value, icon: Icon, tone, foot, index, loading }) {
  return (
    <Panel className="reveal group p-4 sm:p-5 transition-transform duration-500 ease-out hover:-translate-y-0.5" style={{ "--i": index }}>
      <div className="flex items-center justify-between">
        <p className="truncate text-[13px] font-medium text-fg-3">{text}</p>
        <span className="flex size-8 items-center justify-center rounded-full bg-white/[0.06] ring-1 ring-inset ring-line">
          <Icon className="size-4" style={{ color: TONE_HEX[tone] }} aria-hidden />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-4 h-10 w-20" />
      ) : (
        <p className="tabular mt-3 text-[2.1rem] sm:text-[2.6rem] font-semibold leading-none tracking-[-0.04em]">{value ?? 0}</p>
      )}
      <p className="mt-2 text-xs text-fg-3">{foot}</p>
    </Panel>
  );
}

const SERIES = [
  { key: "present", label: "On time", color: TONE_HEX.ok },
  { key: "late", label: "Late", color: TONE_HEX.warn },
  { key: "incomplete", label: "Incomplete", color: TONE_HEX.info },
  { key: "absent", label: "Absent", color: TONE_HEX.bad },
];

function Legend() {
  return (
    <ul className="hidden flex-wrap gap-x-4 gap-y-1 sm:flex">
      {SERIES.map((series) => (
        <li key={series.key} className="flex items-center gap-1.5 text-xs text-fg-3">
          <span className="size-2 rounded-full" style={{ background: series.color }} aria-hidden />
          {series.label}
        </li>
      ))}
    </ul>
  );
}

function TrendChart({ data }) {
  const rows = data.map((day) => ({
    ...day,
    day: new Date(`${day.date}T00:00:00`).toLocaleDateString([], { weekday: "short" }),
  }));

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} barCategoryGap="28%" margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
        <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
        <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#9099a5", fontSize: 12 }} />
        <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#9099a5", fontSize: 12 }} />
        <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<ChartTooltip />} />
        {SERIES.map((series, i) => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.label}
            stackId="day"
            fill={series.color}
            fillOpacity={0.85}
            radius={i === SERIES.length - 1 ? [6, 6, 0, 0] : 0}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function ChartTooltip({ active, payload, label: day }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass glass-strong rounded-2xl px-4 py-3 text-xs">
      <p className="mb-2 font-medium text-fg">{day}{payload[0].payload.working_day ? "" : " · day off"}</p>
      {payload.map((item) => (
        <p key={item.dataKey} className="flex items-center justify-between gap-6 py-0.5 text-fg-2">
          <span className="flex items-center gap-2">
            <span className="size-2 rounded-full" style={{ background: item.color }} aria-hidden />
            {label(item.name)}
          </span>
          <span className="tabular text-fg">{item.value}</span>
        </p>
      ))}
    </div>
  );
}
