import { useEffect, useState } from "react";
import { Pencil, Save, UserPlus, Users } from "lucide-react";
import { api, useApi } from "../api";
import { useAuth } from "../auth";
import {
  Avatar, Badge, Button, Empty, ErrorNote, Field, IconButton, Input, Modal, PageHeader, Panel, Segmented, Select,
  Skeleton, Table, cx, fmtDateTime, label, useToast,
} from "../ui";

export default function Settings() {
  const [tab, setTab] = useState("policy");
  return (
    <>
      <PageHeader
        title="Settings"
        description="Working hours, recognition strictness and who can use SmartGate."
        actions={
          <Segmented
            label="Settings section"
            value={tab}
            onChange={setTab}
            options={[
              { value: "policy", label: "Attendance" },
              { value: "recognition", label: "Recognition" },
              { value: "team", label: "Team" },
            ]}
          />
        }
      />
      {tab === "policy" && <Policy />}
      {tab === "recognition" && <Recognition />}
      {tab === "team" && <Team />}
    </>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMEZONES = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Asia/Karachi", "UTC"];
const hhmm = (t) => (t ? t.slice(0, 5) : "");

function Policy() {
  const notify = useToast();
  const { data, error } = useApi("/api/attendance/policy");
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (data?.policy) {
      const p = data.policy;
      setForm({ ...p, work_start: hhmm(p.work_start), work_end: hhmm(p.work_end), auto_close_time: hhmm(p.auto_close_time) });
    } else if (error?.status === 404) {
      setForm({
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Karachi",
        work_start: "09:00", work_end: "17:00", grace_minutes: 10, working_days: [1, 2, 3, 4, 5], auto_close_time: "23:30",
      });
    }
  }, [data, error]);

  if (!form) return error && error.status !== 404 ? <ErrorNote error={error} /> : <Skeleton className="h-96" />;

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));
  const toggleDay = (day) =>
    setForm((f) => ({
      ...f,
      working_days: f.working_days.includes(day) ? f.working_days.filter((d) => d !== day) : [...f.working_days, day].sort(),
    }));

  async function save(event) {
    event.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      await api("/api/attendance/policy", {
        method: "PUT",
        body: {
          timezone: form.timezone,
          work_start: form.work_start,
          work_end: form.work_end,
          grace_minutes: Number(form.grace_minutes),
          working_days: form.working_days,
          auto_close_time: form.auto_close_time,
        },
      });
      notify("Attendance policy saved");
    } catch (err) {
      setSaveError(err);
    }
    setBusy(false);
  }

  return (
    <Panel as="form" onSubmit={save} className="reveal max-w-3xl p-6 sm:p-8">
      {error?.status === 404 && (
        <p className="mb-6 rounded-2xl bg-warn/10 px-4 py-3 text-sm text-warn ring-1 ring-inset ring-warn/25">
          No policy yet. Save once to start recording attendance.
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Timezone" className="sm:col-span-2" hint="Used for working days, lateness and reports.">
          {(id) => (
            <Select id={id} value={form.timezone} onChange={set("timezone")}>
              {/* The browser list omits aliases such as "UTC"; always keep the saved value
                  selectable so saving never silently changes the timezone. */}
              {[...new Set([form.timezone, "UTC", ...TIMEZONES])].map((tz) => <option key={tz} value={tz}>{tz}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Work starts">{(id) => <Input id={id} type="time" required value={form.work_start} onChange={set("work_start")} />}</Field>
        <Field label="Work ends">{(id) => <Input id={id} type="time" required value={form.work_end} onChange={set("work_end")} />}</Field>
        <Field label="Grace period (minutes)" hint="Arrivals within this window are on time.">
          {(id) => <Input id={id} type="number" min={0} max={1440} required value={form.grace_minutes} onChange={set("grace_minutes")} />}
        </Field>
        <Field label="Auto check-out" hint="Forgotten check-outs close at this time.">
          {(id) => <Input id={id} type="time" required value={form.auto_close_time} onChange={set("auto_close_time")} />}
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-2 text-[13px] font-medium text-fg-2">Working days</legend>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((day, i) => {
              const on = form.working_days.includes(i + 1);
              return (
                <button
                  key={day}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleDay(i + 1)}
                  className={cx(
                    "h-11 w-14 cursor-pointer rounded-2xl text-sm font-medium ring-1 ring-inset transition-colors duration-200",
                    on ? "bg-accent/15 text-accent ring-accent/40" : "text-fg-3 ring-line hover:text-fg"
                  )}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </fieldset>
      </div>
      <div className="mt-6"><ErrorNote error={saveError} /></div>
      <div className="mt-6 flex justify-end">
        <Button type="submit" variant="primary" icon={Save} loading={busy} disabled={!form.working_days.length}>Save policy</Button>
      </div>
    </Panel>
  );
}

function Recognition() {
  const notify = useToast();
  const { data, error } = useApi("/api/recognition/settings");
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  if (!form) return error ? <ErrorNote error={error} /> : <Skeleton className="h-72" />;

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      await api("/api/recognition/settings", {
        method: "PUT",
        body: { match_threshold: Number(form.match_threshold), liveness_required: form.liveness_required },
      });
      notify("Recognition settings saved");
    } catch (err) {
      setSaveError(err);
    }
    setBusy(false);
  }

  const threshold = Number(form.match_threshold);
  const strictness = threshold <= 0.42 ? "Strict" : threshold <= 0.55 ? "Balanced" : "Lenient";

  return (
    <Panel className="reveal max-w-3xl p-6 sm:p-8">
      <div className="flex items-baseline justify-between gap-4">
        <label htmlFor="threshold" className="text-[15px] font-semibold">Match threshold</label>
        <span className="tabular text-sm text-fg-2">{threshold.toFixed(2)} · {strictness}</span>
      </div>
      <p className="mt-1 text-sm text-fg-3">Lower is stricter: fewer false matches, but people may need a second look at the camera.</p>
      <input
        id="threshold"
        type="range"
        min={0.3}
        max={0.7}
        step={0.01}
        value={threshold}
        onChange={(e) => setForm((f) => ({ ...f, match_threshold: e.target.value }))}
        className="mt-5 w-full cursor-pointer accent-[#7cf0c5]"
      />
      <div className="mt-1 flex justify-between text-xs text-fg-3"><span>Strict</span><span>Lenient</span></div>

      <div className="mt-8 flex items-start justify-between gap-6 border-t border-line pt-6">
        <div>
          <p className="text-[15px] font-semibold" id="liveness-label">Require a blink</p>
          <p className="mt-1 max-w-md text-sm text-fg-3">The kiosk asks people to blink before matching, which stops printed photos.</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={form.liveness_required}
          aria-labelledby="liveness-label"
          onClick={() => setForm((f) => ({ ...f, liveness_required: !f.liveness_required }))}
          className={cx(
            "relative h-8 w-14 shrink-0 cursor-pointer rounded-full ring-1 ring-inset transition-colors duration-300",
            form.liveness_required ? "bg-accent ring-accent" : "bg-white/10 ring-line"
          )}
        >
          <span
            className={cx(
              "absolute top-1 size-6 rounded-full bg-white shadow transition-transform duration-300 ease-out",
              form.liveness_required ? "translate-x-7" : "translate-x-1"
            )}
          />
        </button>
      </div>
      <div className="mt-6"><ErrorNote error={saveError} /></div>
      <div className="mt-6 flex justify-end">
        <Button variant="primary" icon={Save} loading={busy} onClick={save}>Save settings</Button>
      </div>
    </Panel>
  );
}

const ROLES = ["manager", "gate_operator", "viewer"];

function Team() {
  const { user: me } = useAuth();
  const { data, error, loading, reload } = useApi("/api/users?limit=100");
  const [editing, setEditing] = useState(null);

  return (
    <Panel className="reveal p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-4 px-2">
        <p className="text-sm text-fg-3">People who can sign in to this organization.</p>
        <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setEditing({})}>Add member</Button>
      </div>
      <ErrorNote error={error} onRetry={reload} />
      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
      ) : (
        <Table
          rows={data?.users ?? []}
          empty={<Empty icon={Users} title="Just you so far" />}
          columns={[
            {
              key: "full_name",
              header: "Member",
              render: (u) => (
                <span className="flex items-center gap-3">
                  <Avatar name={u.full_name} />
                  <span>
                    <span className="block font-medium text-fg">{u.full_name}{u.id === me.id && <span className="ml-2 text-xs text-fg-3">you</span>}</span>
                    <span className="block text-xs text-fg-3">{u.email}</span>
                  </span>
                </span>
              ),
            },
            { key: "role", header: "Role", render: (u) => <Badge tone="idle" dot={false}>{u.role}</Badge> },
            { key: "is_active", header: "Status", render: (u) => <Badge>{u.is_active ? "active" : "inactive"}</Badge> },
            { key: "last_login_at", header: "Last sign-in", className: "tabular", render: (u) => fmtDateTime(u.last_login_at) },
            {
              key: "actions",
              header: <span className="sr-only">Actions</span>,
              className: "text-right",
              render: (u) => u.id !== me.id && u.role !== "org_admin" && <IconButton label={`Edit ${u.full_name}`} icon={Pencil} onClick={() => setEditing(u)} />,
            },
          ]}
        />
      )}
      {editing && <MemberForm member={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </Panel>
  );
}

function MemberForm({ member, onClose, onSaved }) {
  const notify = useToast();
  const isNew = !member.id;
  const [form, setForm] = useState({
    full_name: member.full_name ?? "",
    email: member.email ?? "",
    role: member.role ?? "gate_operator",
    department: member.department ?? "",
    password: "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  async function send(body, message) {
    setBusy(true);
    setError(null);
    try {
      if (isNew) await api("/api/users", { method: "POST", body });
      else await api(`/api/users/${member.id}`, { method: "PATCH", body });
      notify(message);
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  function save(event) {
    event.preventDefault();
    const fields = { full_name: form.full_name, email: form.email, role: form.role, department: form.department || null };
    // On edit, send only what changed: email/role changes sign the member out.
    const body = isNew
      ? fields
      : Object.fromEntries(Object.entries(fields).filter(([key, value]) => value !== (member[key] ?? null)));
    if (isNew || form.password) body.password = form.password;
    if (!Object.keys(body).length) return onClose();
    send(body, isNew ? "Member added" : "Changes saved");
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add member" : `Edit ${member.full_name}`}
      footer={
        <>
          {!isNew && (
            <Button
              variant={member.is_active ? "danger" : "glass"}
              className="mr-auto"
              disabled={busy}
              onClick={() => send({ is_active: !member.is_active }, member.is_active ? "Member deactivated" : "Member reactivated")}
            >
              {member.is_active ? "Deactivate" : "Reactivate"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="member-form" variant="primary" loading={busy}>{isNew ? "Add member" : "Save"}</Button>
        </>
      }
    >
      <form id="member-form" onSubmit={save} className="flex flex-col gap-4">
        <Field label="Full name">{(id) => <Input id={id} required maxLength={100} value={form.full_name} onChange={set("full_name")} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" required value={form.email} onChange={set("email")} />}</Field>
        <Field label="Role" hint={form.role === "gate_operator" ? "Runs the gate kiosk and reviews alerts." : form.role === "manager" ? "Reads everything and reviews alerts." : "Read-only access to attendance."}>
          {(id) => (
            <Select id={id} value={form.role} onChange={set("role")}>
              {ROLES.map((r) => <option key={r} value={r}>{label(r)}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Department">{(id) => <Input id={id} maxLength={100} value={form.department} onChange={set("department")} />}</Field>
        <Field label={isNew ? "Password" : "New password"} hint={isNew ? "At least 12 characters." : "Leave empty to keep the current password."}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" required={isNew} minLength={12} value={form.password} onChange={set("password")} />}
        </Field>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
