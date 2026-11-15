import { useMemo, useState } from "react";
import { Check, Inbox, Mail, RotateCcw, ScrollText, ShieldCheck, Trash2, UserPlus, X } from "lucide-react";
import { api, query, useAction, useApi } from "../api";
import { useAuth } from "../auth";
import { fmtDateTime, label, timeAgo } from "../format";
import Snapshot from "../snapshot";
import {
  Badge, Button, Empty, ErrorNote, Field, IconButton, Input, LoadingRows, Modal, PageHeader, Pagination, Panel,
  Segmented, Skeleton, Table, Textarea, cx, useToast,
} from "../ui";

// Alerts page. Everyone who can open it sees unknown faces; admins also get
// the recipients, notifications and audit log tabs.
export default function Alerts() {
  const { isAdmin } = useAuth();
  const [tab, setTab] = useState("faces");

  const tabs = [
    { value: "faces", label: "Unknown faces" },
    ...(isAdmin
      ? [
          { value: "recipients", label: "Recipients" },
          { value: "notifications", label: "Notifications" },
          { value: "audit", label: "Audit log" },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Faces the kiosk could not match, who gets told about them, and a record of every review."
        actions={tabs.length > 1 && <Segmented label="Alerts view" value={tab} onChange={setTab} options={tabs} />}
      />
      {tab === "faces" && <UnknownFaces />}
      {tab === "recipients" && <Recipients />}
      {tab === "notifications" && <Notifications />}
      {tab === "audit" && <AuditLog />}
    </>
  );
}

// Grid of unknown-face photos, filtered by status. Refreshes every 20 seconds.
function UnknownFaces() {
  const { user } = useAuth();
  const canReview = user.role === "org_admin" || user.role === "manager";
  const [status, setStatus] = useState("new");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState(null);
  const { data, error, loading, reload } = useApi(`/api/alerts/unknown-faces${query({ status, page, limit: 24 })}`, { refreshMs: 20000 });
  const gates = useApi("/api/attendance/gates");
  const gateName = useMemo(() => Object.fromEntries((gates.data?.gates ?? []).map((g) => [g.id, g.name])), [gates.data]);

  const counts = data?.counts;
  const options = ["new", "reviewed", "dismissed"].map((value) => ({
    value,
    label: `${label(value)}${counts ? ` ${counts[value]}` : ""}`,
  }));

  return (
    <>
      <div className="reveal mb-5">
        <Segmented label="Alert status" value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={options} />
      </div>
      <ErrorNote error={error} onRetry={reload} />

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="aspect-[3/4]" />)}
        </div>
      ) : data?.unknown_faces.length === 0 ? (
        <Panel className="reveal">
          <Empty icon={ShieldCheck} title={status === "new" ? "Nothing to review" : `No ${status} alerts`}>
            {status === "new" ? "Unrecognized faces at a gate appear here with a snapshot." : "Alerts move here once they are handled."}
          </Empty>
        </Panel>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {data?.unknown_faces.map((face, i) => (
              <button
                key={face.id}
                type="button"
                onClick={() => setOpen(face)}
                className="glass reveal group cursor-pointer overflow-hidden rounded-3xl p-2 text-left transition-transform duration-500 ease-out hover:-translate-y-1"
                style={{ "--i": Math.min(i, 12) }}
                aria-label={`Unknown face at ${gateName[face.gate_id] ?? "a gate"}, ${timeAgo(face.captured_at)}`}
              >
                <Snapshot url={face.snapshot_url} alt="" className="aspect-square rounded-[20px]" />
                <div className="px-2 pb-1.5 pt-3">
                  <p className="truncate text-sm font-medium text-fg">{gateName[face.gate_id] ?? "Unknown gate"}</p>
                  <p className="mt-0.5 text-xs text-fg-3">{timeAgo(face.captured_at)}</p>
                </div>
              </button>
            ))}
          </div>
          {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
        </>
      )}

      {open && (
        <ReviewModal
          face={open}
          gate={gateName[open.gate_id]}
          canReview={canReview}
          onClose={() => setOpen(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}

// The photo of one unknown face, with buttons to review or dismiss it.
function ReviewModal({ face, gate, canReview, onClose, onSaved }) {
  const notify = useToast();
  const [note, setNote] = useState(face.note ?? "");
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function set(status) {
    setBusy(status);
    setError(null);
    try {
      await api(`/api/alerts/unknown-faces/${face.id}`, { method: "PATCH", body: { status, note: note.trim() || null } });
      notify(status === "new" ? "Alert reopened" : `Alert ${status}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title="Unknown face"
      description={`${gate ?? "Unknown gate"} · ${fmtDateTime(face.captured_at)}`}
      footer={
        canReview && (
          <>
            {face.status !== "new" && <Button variant="ghost" icon={RotateCcw} loading={busy === "new"} onClick={() => set("new")} className="mr-auto">Reopen</Button>}
            <Button icon={X} loading={busy === "dismissed"} onClick={() => set("dismissed")}>Dismiss</Button>
            <Button variant="primary" icon={Check} loading={busy === "reviewed"} onClick={() => set("reviewed")}>Mark reviewed</Button>
          </>
        )
      }
    >
      <div className="grid gap-6 sm:grid-cols-[240px_1fr]">
        <Snapshot url={face.snapshot_url} alt="Unknown visitor snapshot" className="aspect-square rounded-3xl ring-1 ring-line" />
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-inset ring-line">
              <dt className="text-xs text-fg-3">Status</dt>
              <dd className="mt-1"><Badge>{face.status}</Badge></dd>
            </div>
            <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-inset ring-line">
              <dt className="text-xs text-fg-3">Closest match distance</dt>
              <dd className="tabular mt-1 text-fg">{face.best_distance == null ? "No faces enrolled" : face.best_distance.toFixed(2)}</dd>
            </div>
          </dl>
          {face.reviewed_at && <p className="text-xs text-fg-3">Last handled {fmtDateTime(face.reviewed_at)}</p>}
          {canReview ? (
            <Field label="Note" hint="Optional, for example who the visitor was.">
              {(id) => <Textarea id={id} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
          ) : (
            face.note && <p className="text-sm text-fg-2">{face.note}</p>
          )}
          <ErrorNote error={error} />
        </div>
      </div>
    </Modal>
  );
}

const ALERT_TYPES = ["unknown_face", "late_arrival", "forgot_checkout", "daily_summary"];

// Email addresses that are told about alerts.
function Recipients() {
  const notify = useToast();
  const { data, error, loading, reload } = useApi("/api/alerts/recipients");
  const [email, setEmail] = useState("");
  const [types, setTypes] = useState(["unknown_face"]);
  const { busy, error: formError, run } = useAction();

  async function add(event) {
    event.preventDefault();
    const body = { email, alert_types: types };
    if (await run(() => api("/api/alerts/recipients", { method: "POST", body }))) {
      notify("Recipient added");
      setEmail("");
      reload();
    }
  }

  async function remove(id) {
    try {
      await api(`/api/alerts/recipients/${id}`, { method: "DELETE" });
      notify("Recipient removed");
      reload();
    } catch (err) {
      notify(err.message, "bad");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Panel className="reveal h-fit p-6">
        <h2 className="text-[15px] font-semibold">Add recipient</h2>
        <form onSubmit={add} className="mt-5 flex flex-col gap-4">
          <Field label="Email">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="security@organization.edu" />}</Field>
          <fieldset>
            <legend className="mb-2 text-[13px] font-medium text-fg-2">Notify about</legend>
            <div className="flex flex-wrap gap-2">
              {ALERT_TYPES.map((type) => {
                const on = types.includes(type);
                return (
                  <button
                    key={type}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTypes((t) => (on ? t.filter((x) => x !== type) : [...t, type]))}
                    className={cx(
                      "h-9 cursor-pointer rounded-full px-3.5 text-[13px] ring-1 ring-inset transition-colors duration-200",
                      on ? "bg-accent/15 text-accent ring-accent/40" : "text-fg-3 ring-line hover:text-fg"
                    )}
                  >
                    {label(type)}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <ErrorNote error={formError} />
          <Button type="submit" variant="primary" icon={UserPlus} loading={busy} disabled={!types.length}>Add recipient</Button>
        </form>
      </Panel>

      <Panel className="reveal p-4 sm:p-6" style={{ "--i": 1 }}>
        <ErrorNote error={error} onRetry={reload} />
        {loading ? (
          <LoadingRows />
        ) : (
          <Table
            rows={data?.recipients ?? []}
            empty={<Empty icon={Mail} title="No recipients">Add the people who should hear about unknown faces.</Empty>}
            columns={[
              { key: "email", header: "Email", render: (r) => <span className="font-medium text-fg">{r.email}</span> },
              {
                key: "alert_types",
                header: "Alerts",
                render: (r) => <span className="flex flex-wrap gap-1.5">{r.alert_types.map((t) => <Badge key={t} tone="idle" dot={false}>{t}</Badge>)}</span>,
              },
              {
                key: "actions",
                header: <span className="sr-only">Actions</span>,
                className: "text-right",
                render: (r) => <IconButton label={`Remove ${r.email}`} icon={Trash2} onClick={() => remove(r.id)} className="hover:text-bad" />,
              },
            ]}
          />
        )}
      </Panel>
    </div>
  );
}

// Notifications waiting to be emailed (no email sender is set up yet).
function Notifications() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(`/api/alerts/notifications${query({ page, limit: 25 })}`);
  return (
    <Panel className="reveal p-4 sm:p-6">
      <ErrorNote error={error} onRetry={reload} />
      <p className="mb-4 px-2 text-xs text-fg-3">Email delivery is not configured yet, so notifications stay queued here.</p>
      {loading ? (
        <LoadingRows />
      ) : (
        <>
          <Table
            rows={data?.notifications ?? []}
            empty={<Empty icon={Inbox} title="No notifications">They are created when an alert reaches a recipient.</Empty>}
            columns={[
              { key: "created_at", header: "Created", className: "tabular whitespace-nowrap", render: (n) => fmtDateTime(n.created_at) },
              { key: "recipient", header: "Recipient", render: (n) => <span className="text-fg">{n.recipient}</span> },
              { key: "subject", header: "Subject" },
              { key: "status", header: "Status", render: (n) => <Badge>{n.status}</Badge> },
            ]}
          />
          {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
        </>
      )}
    </Panel>
  );
}

// Who reviewed which alert and who changed the recipients.
function AuditLog() {
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(`/api/alerts/audit-logs${query({ page, limit: 25 })}`);
  return (
    <Panel className="reveal p-4 sm:p-6">
      <ErrorNote error={error} onRetry={reload} />
      {loading ? (
        <LoadingRows />
      ) : (
        <>
          <Table
            rows={data?.audit_logs ?? []}
            empty={<Empty icon={ScrollText} title="Nothing recorded yet">Reviews and recipient changes are logged here.</Empty>}
            columns={[
              { key: "created_at", header: "When", className: "tabular whitespace-nowrap", render: (a) => fmtDateTime(a.created_at) },
              { key: "action", header: "Action", render: (a) => <span className="font-mono text-[13px] text-fg">{a.action}</span> },
              { key: "details", header: "Details", render: (a) => (a.details ? Object.values(a.details).join(" · ") : "—") },
            ]}
          />
          {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
        </>
      )}
    </Panel>
  );
}
