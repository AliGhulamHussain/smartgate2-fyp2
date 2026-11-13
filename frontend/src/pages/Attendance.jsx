import { useState } from "react";
import { CalendarX2, History } from "lucide-react";
import { query, useApi } from "../api";
import {
  Avatar, Badge, Empty, ErrorNote, Field, Input, PageHeader, Pagination, Panel, Segmented, Select, Skeleton, Table,
  fmtDateTime, fmtMinutes, fmtTime, label,
} from "../ui";

export default function Attendance() {
  const [tab, setTab] = useState("daily");
  return (
    <>
      <PageHeader
        title="Attendance"
        description="Daily outcomes per employee and the raw gate history behind them."
        actions={
          <Segmented
            label="Attendance view"
            value={tab}
            onChange={setTab}
            options={[
              { value: "daily", label: "Daily report" },
              { value: "logs", label: "Gate history" },
            ]}
          />
        }
      />
      {tab === "daily" ? <Daily /> : <Logs />}
    </>
  );
}

const DAY_STATUSES = ["present", "late", "absent", "incomplete", "weekend", "holiday"];

function Daily() {
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(`/api/attendance/daily${query({ date, status, page, limit: 25 })}`);

  const summary = data?.summary;
  const chips = ["present", "late", "absent", "incomplete"];

  return (
    <>
      <ErrorNote error={error} onRetry={reload} />
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Panel className="reveal flex h-fit flex-col gap-5 p-6">
          <Field label="Date">
            {(id) => (
              <Input
                id={id}
                type="date"
                max={new Date().toISOString().slice(0, 10)}
                value={date || data?.date || ""}
                onChange={(e) => {
                  setDate(e.target.value);
                  setPage(1);
                }}
              />
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select
                id={id}
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Everyone</option>
                {DAY_STATUSES.map((s) => <option key={s} value={s}>{label(s)}</option>)}
              </Select>
            )}
          </Field>
          {data && (
            <div className="border-t border-line pt-5">
              <p className="text-[13px] text-fg-3">
                {data.day_type === "working" ? "Working day" : data.day_type === "holiday" ? `Holiday${data.holiday_name ? ` · ${data.holiday_name}` : ""}` : "Weekend"}
              </p>
              <dl className="mt-3 grid grid-cols-2 gap-3">
                {chips.map((key) => (
                  <div key={key} className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-inset ring-line">
                    <dt className="text-xs text-fg-3">{label(key)}</dt>
                    <dd className="tabular mt-1 text-xl font-semibold">{summary[key]}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </Panel>

        <Panel className="reveal p-4 sm:p-6" style={{ "--i": 1 }}>
          {loading ? (
            <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <>
              <Table
                rowKey="employee_id"
                rows={data?.records ?? []}
                empty={<Empty icon={CalendarX2} title="No records">No employees match this day and filter.</Empty>}
                columns={[
                  {
                    key: "full_name",
                    header: "Employee",
                    render: (r) => (
                      <span className="flex items-center gap-3">
                        <Avatar name={r.full_name} />
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-fg">{r.full_name}</span>
                          <span className="block text-xs text-fg-3">{r.employee_code}{r.department ? ` · ${r.department}` : ""}</span>
                        </span>
                      </span>
                    ),
                  },
                  { key: "day_status", header: "Status", render: (r) => <Badge>{r.day_status}</Badge> },
                  { key: "first_check_in", header: "First in", className: "tabular", render: (r) => fmtTime(r.first_check_in) },
                  { key: "last_check_out", header: "Last out", className: "tabular", render: (r) => fmtTime(r.last_check_out) },
                  { key: "total_minutes", header: "Worked", className: "tabular", render: (r) => fmtMinutes(r.total_minutes) },
                  {
                    key: "late_by_minutes",
                    header: "Late by",
                    className: "tabular text-right",
                    render: (r) => (r.late_by_minutes ? <span className="text-warn">{fmtMinutes(r.late_by_minutes)}</span> : "—"),
                  },
                ]}
              />
              {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

function Logs() {
  const [filters, setFilters] = useState({ from: "", to: "", action: "", status: "" });
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useApi(`/api/attendance/logs${query({ ...filters, page, limit: 25 })}`);

  const set = (key) => (event) => {
    setFilters((f) => ({ ...f, [key]: event.target.value }));
    setPage(1);
  };

  return (
    <>
      <ErrorNote error={error} onRetry={reload} />
      <Panel className="reveal mb-4 grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="From">{(id) => <Input id={id} type="date" value={filters.from} onChange={set("from")} />}</Field>
        <Field label="To">{(id) => <Input id={id} type="date" value={filters.to} onChange={set("to")} />}</Field>
        <Field label="Action">
          {(id) => (
            <Select id={id} value={filters.action} onChange={set("action")}>
              <option value="">All</option>
              <option value="check_in">Check in</option>
              <option value="check_out">Check out</option>
            </Select>
          )}
        </Field>
        <Field label="Outcome">
          {(id) => (
            <Select id={id} value={filters.status} onChange={set("status")}>
              <option value="">All</option>
              {["on_time", "late", "normal", "early_leave"].map((s) => <option key={s} value={s}>{label(s)}</option>)}
            </Select>
          )}
        </Field>
      </Panel>

      <Panel className="reveal p-4 sm:p-6" style={{ "--i": 1 }}>
        {loading ? (
          <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : (
          <>
            <Table
              rows={data?.logs ?? []}
              empty={<Empty icon={History} title="No gate events">Nothing was recorded for these filters.</Empty>}
              columns={[
                { key: "logged_at", header: "Time", className: "tabular whitespace-nowrap", render: (r) => fmtDateTime(r.logged_at) },
                {
                  key: "full_name",
                  header: "Employee",
                  render: (r) => (
                    <span>
                      <span className="font-medium text-fg">{r.full_name}</span>
                      <span className="ml-2 text-xs text-fg-3">{r.employee_code}</span>
                    </span>
                  ),
                },
                { key: "action", header: "Action", render: (r) => <Badge>{r.action}</Badge> },
                { key: "status", header: "Outcome", render: (r) => <Badge dot={false}>{r.status}</Badge> },
                { key: "gate_name", header: "Gate" },
                {
                  key: "confidence",
                  header: "Match",
                  className: "tabular text-right",
                  render: (r) => (r.confidence == null ? "—" : `${Math.round(r.confidence * 100)}%`),
                },
              ]}
            />
            {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} />}
          </>
        )}
      </Panel>
    </>
  );
}
