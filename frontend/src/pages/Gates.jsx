import { useState } from "react";
import { ArrowDownToLine, ArrowLeftRight, ArrowUpFromLine, DoorClosed, Pencil, Plus, ScanFace } from "lucide-react";
import { api, useApi } from "../api";
import { useAuth } from "../auth";
import { Badge, Button, Empty, ErrorNote, Field, Input, Modal, PageHeader, Panel, Segmented, Skeleton, cx, useToast } from "../ui";

const DIRECTION = {
  entry: { label: "Entry only", icon: ArrowDownToLine, help: "Every recognition is a check-in." },
  exit: { label: "Exit only", icon: ArrowUpFromLine, help: "Every recognition is a check-out." },
  both: { label: "Entry and exit", icon: ArrowLeftRight, help: "Checks people in or out depending on whether they are inside." },
};

export default function Gates() {
  const { isAdmin, can } = useAuth();
  const { data, error, loading, reload } = useApi("/api/attendance/gates");
  const [editing, setEditing] = useState(null);
  const gates = data?.gates ?? [];

  return (
    <>
      <PageHeader
        title="Gates"
        description="Each gate runs a kiosk. Its direction decides whether a recognized face checks in or out."
        actions={isAdmin && <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Add gate</Button>}
      />
      <ErrorNote error={error} onRetry={reload} />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-48" />)}</div>
      ) : gates.length === 0 ? (
        <Panel className="reveal">
          <Empty icon={DoorClosed} title="No gates yet" action={isAdmin && <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Add a gate</Button>}>
            Add the doors or turnstiles where a kiosk will recognize people.
          </Empty>
        </Panel>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {gates.map((gate, i) => {
            const direction = DIRECTION[gate.direction];
            const Icon = direction.icon;
            const active = gate.status === "active";
            return (
              <Panel key={gate.id} className={cx("reveal group flex flex-col p-6 transition-transform duration-500 ease-out hover:-translate-y-0.5", !active && "opacity-60")} style={{ "--i": i }}>
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-white/[0.06] ring-1 ring-inset ring-line transition-transform duration-500 ease-out group-hover:scale-105">
                    <Icon className="size-5 text-accent" aria-hidden />
                  </span>
                  <Badge>{gate.status}</Badge>
                </div>
                <h2 className="mt-6 text-xl font-semibold tracking-tight">{gate.name}</h2>
                <p className="mt-1 text-sm text-fg-3">{direction.label}</p>
                <div className="mt-6 flex gap-2 pt-1">
                  {can("kiosk") && active && (
                    <a
                      href={`#/kiosk/${gate.id}`}
                      className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-3.5 text-[13px] font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
                    >
                      <ScanFace className="size-4" aria-hidden /> Open kiosk
                    </a>
                  )}
                  {isAdmin && <Button size="sm" icon={Pencil} onClick={() => setEditing(gate)}>Edit</Button>}
                </div>
              </Panel>
            );
          })}
        </div>
      )}

      {editing && <GateForm gate={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </>
  );
}

function GateForm({ gate, onClose, onSaved }) {
  const notify = useToast();
  const isNew = !gate.id;
  const [name, setName] = useState(gate.name ?? "");
  const [direction, setDirection] = useState(gate.direction ?? "both");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function run(body, message) {
    setBusy(true);
    setError(null);
    try {
      if (isNew) await api("/api/attendance/gates", { method: "POST", body });
      else await api(`/api/attendance/gates/${gate.id}`, { method: "PATCH", body });
      notify(message);
      onSaved();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add gate" : `Edit ${gate.name}`}
      footer={
        <>
          {!isNew && (
            <Button
              variant={gate.status === "active" ? "danger" : "glass"}
              className="mr-auto"
              disabled={busy}
              onClick={() =>
                run({ status: gate.status === "active" ? "inactive" : "active" }, gate.status === "active" ? "Gate deactivated" : "Gate reactivated")
              }
            >
              {gate.status === "active" ? "Deactivate" : "Reactivate"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="gate-form" loading={busy}>{isNew ? "Add gate" : "Save"}</Button>
        </>
      }
    >
      <form
        id="gate-form"
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          run({ name, direction }, isNew ? "Gate added" : "Changes saved");
        }}
      >
        <Field label="Name">{(id) => <Input id={id} required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="Main entrance" />}</Field>
        <div>
          <p className="mb-2 text-[13px] font-medium text-fg-2">Direction</p>
          <Segmented
            label="Direction"
            value={direction}
            onChange={setDirection}
            options={Object.entries(DIRECTION).map(([value, d]) => ({ value, label: d.label }))}
          />
          <p className="mt-2 text-xs text-fg-3">{DIRECTION[direction].help}</p>
        </div>
        <ErrorNote error={error} />
      </form>
    </Modal>
  );
}
