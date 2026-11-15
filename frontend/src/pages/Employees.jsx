import { Suspense, lazy, useState } from "react";
import { CheckCircle2, Pencil, Plus, ScanFace, Search, UserRoundX, Users } from "lucide-react";
import { api, query, useAction, useApi } from "../api";
import { useAuth } from "../auth";
import {
  Avatar, Badge, Button, Empty, ErrorNote, Field, IconButton, Input, LoadingRows, Modal, PageHeader, Pagination, Panel,
  Select, Table, useToast,
} from "../ui";

// face-api and TensorFlow.js are large; load them only when enrolling.
const EnrollFace = lazy(() => import("./EnrollFace"));

// Employee list with search and filters. Admins can add, edit and enroll faces.
export default function Employees() {
  const { isAdmin } = useAuth();
  const [filters, setFilters] = useState({ search: "", status: "", presence: "" });
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState(null);
  const [enrolling, setEnrolling] = useState(null);
  const { data, error, loading, reload } = useApi(`/api/attendance/employees${query({ ...filters, page, limit: 20 })}`);

  const set = (key) => (event) => {
    setFilters((f) => ({ ...f, [key]: event.target.value }));
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Employees"
        description="People who can be recognized at your gates. Deactivate instead of deleting to keep their history."
        actions={isAdmin && <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Add employee</Button>}
      />
      <ErrorNote error={error} onRetry={reload} />

      <Panel className="reveal mb-4 grid gap-3 p-4 sm:grid-cols-[1fr_180px_180px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
          <Input aria-label="Search employees" placeholder="Search name or code" value={filters.search} onChange={set("search")} className="pl-10" />
        </div>
        <Select aria-label="Status" value={filters.status} onChange={set("status")}>
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Select aria-label="Presence" value={filters.presence} onChange={set("presence")}>
          <option value="">Inside or outside</option>
          <option value="inside">Inside</option>
          <option value="outside">Outside</option>
        </Select>
      </Panel>

      <Panel className="reveal p-4 sm:p-6" style={{ "--i": 1 }}>
        {loading ? (
          <LoadingRows count={5} height="h-14" />
        ) : (
          <>
            <Table
              rows={data?.employees ?? []}
              empty={
                <Empty
                  icon={Users}
                  title={filters.search || filters.status || filters.presence ? "No matches" : "No employees yet"}
                  action={isAdmin && !filters.search && <Button variant="primary" icon={Plus} onClick={() => setEditing({})}>Add the first employee</Button>}
                >
                  Add people, then enroll their faces so the kiosk can recognize them.
                </Empty>
              }
              columns={[
                {
                  key: "full_name",
                  header: "Employee",
                  render: (e) => (
                    <span className="flex items-center gap-3">
                      <Avatar name={e.full_name} />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-fg">{e.full_name}</span>
                        <span className="block text-xs text-fg-3">{e.employee_code}{e.email ? ` · ${e.email}` : ""}</span>
                      </span>
                    </span>
                  ),
                },
                { key: "department", header: "Department", render: (e) => e.department ?? "—" },
                { key: "status", header: "Status", render: (e) => <Badge>{e.status}</Badge> },
                { key: "presence", header: "Presence", render: (e) => <Badge>{e.presence}</Badge> },
                {
                  key: "face_enrolled",
                  header: "Face",
                  render: (e) =>
                    e.face_enrolled ? (
                      <span className="inline-flex items-center gap-1.5 text-xs text-ok"><CheckCircle2 className="size-4" aria-hidden /> Enrolled</span>
                    ) : (
                      <span className="text-xs text-fg-3">Not enrolled</span>
                    ),
                },
                ...(isAdmin
                  ? [{
                      key: "actions",
                      header: <span className="sr-only">Actions</span>,
                      className: "text-right",
                      render: (e) => (
                        <span className="inline-flex gap-1">
                          {e.status === "active" && <IconButton label={`Enroll face for ${e.full_name}`} icon={ScanFace} onClick={() => setEnrolling(e)} />}
                          <IconButton label={`Edit ${e.full_name}`} icon={Pencil} onClick={() => setEditing(e)} />
                        </span>
                      ),
                    }]
                  : []),
              ]}
            />
            {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
          </>
        )}
      </Panel>

      {editing && <EmployeeForm employee={editing} onClose={() => setEditing(null)} onSaved={reload} />}
      {enrolling && (
        <Suspense fallback={null}>
          <EnrollFace employee={enrolling} onClose={() => setEnrolling(null)} onSaved={reload} />
        </Suspense>
      )}
    </>
  );
}

const FIELDS = ["employee_code", "full_name", "email", "phone", "department", "designation"];
const REQUIRED = ["employee_code", "full_name"];

// Add an employee (employee = {}) or edit one.
function EmployeeForm({ employee, onClose, onSaved }) {
  const notify = useToast();
  const isNew = !employee.id;
  const [form, setForm] = useState(() => Object.fromEntries(FIELDS.map((key) => [key, employee[key] ?? ""])));
  const { busy, error, run } = useAction();

  const set = (key) => (event) => setForm((f) => ({ ...f, [key]: event.target.value }));

  // Saves, then tells the list to reload and closes the dialog.
  async function send(body, message) {
    const saved = await run(() =>
      isNew
        ? api("/api/attendance/employees", { method: "POST", body })
        : api(`/api/attendance/employees/${employee.id}`, { method: "PATCH", body })
    );
    if (saved) {
      notify(message);
      onSaved();
      onClose();
    }
  }

  function save(event) {
    event.preventDefault();
    // Empty optional fields are sent as null, which clears them.
    const body = {};
    for (const [key, value] of Object.entries(form)) {
      body[key] = value.trim() === "" && !REQUIRED.includes(key) ? null : value;
    }
    send(body, isNew ? "Employee added" : "Changes saved");
  }

  function toggleStatus() {
    const status = employee.status === "active" ? "inactive" : "active";
    send({ status }, status === "active" ? "Employee reactivated" : "Employee deactivated");
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={isNew ? "Add employee" : `Edit ${employee.full_name}`}
      footer={
        <>
          {!isNew && (
            <Button variant={employee.status === "active" ? "danger" : "glass"} icon={UserRoundX} onClick={toggleStatus} disabled={busy} className="mr-auto">
              {employee.status === "active" ? "Deactivate" : "Reactivate"}
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="employee-form" loading={busy}>{isNew ? "Add employee" : "Save"}</Button>
        </>
      }
    >
      <form id="employee-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name">{(id) => <Input id={id} required maxLength={100} value={form.full_name} onChange={set("full_name")} />}</Field>
        <Field label="Employee code" hint="Letters, digits, dot, dash or underscore.">
          {(id) => <Input id={id} required maxLength={50} pattern="[A-Za-z0-9._\-]+" value={form.employee_code} onChange={set("employee_code")} />}
        </Field>
        <Field label="Email">{(id) => <Input id={id} type="email" maxLength={150} value={form.email} onChange={set("email")} />}</Field>
        <Field label="Phone">{(id) => <Input id={id} type="tel" maxLength={20} value={form.phone} onChange={set("phone")} placeholder="+92 300 1234567" />}</Field>
        <Field label="Department">{(id) => <Input id={id} maxLength={100} value={form.department} onChange={set("department")} />}</Field>
        <Field label="Designation">{(id) => <Input id={id} maxLength={100} value={form.designation} onChange={set("designation")} />}</Field>
        {error && <div className="sm:col-span-2"><ErrorNote error={error} /></div>}
      </form>
    </Modal>
  );
}
