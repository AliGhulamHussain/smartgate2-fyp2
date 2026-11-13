import { useMemo, useState } from "react";
import { DoorOpen, Search } from "lucide-react";
import { useApi } from "../api";
import { Avatar, Empty, ErrorNote, Input, PageHeader, Panel, Skeleton, fmtTime, timeAgo } from "../ui";

export default function Presence() {
  const { data, error, loading, reload } = useApi("/api/attendance/presence", { refreshMs: 10000 });
  const [search, setSearch] = useState("");

  const people = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.employees ?? []).filter(
      (p) => !term || p.full_name.toLowerCase().includes(term) || p.employee_code.toLowerCase().includes(term)
    );
  }, [data, search]);

  const share = data?.active_employees ? Math.round((data.inside / data.active_employees) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Who is inside"
        description="Live presence, refreshed every few seconds from gate check-ins and check-outs."
        actions={
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-fg-3" aria-hidden />
            <Input aria-label="Search people inside" placeholder="Search name or code" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
          </div>
        }
      />
      <ErrorNote error={error} onRetry={reload} />

      <Panel className="reveal mb-4 flex flex-col gap-5 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-baseline gap-3">
          <span className="tabular text-5xl font-semibold tracking-[-0.04em]">{data?.inside ?? "—"}</span>
          <span className="text-sm text-fg-3">inside of {data?.active_employees ?? "—"} active employees</span>
        </div>
        <div className="w-full sm:max-w-sm">
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100} aria-label="Share inside">
            <div className="h-full rounded-full bg-info transition-[width] duration-700 ease-out" style={{ width: `${share}%` }} />
          </div>
          <p className="tabular mt-2 text-right text-xs text-fg-3">{share}% on site</p>
        </div>
      </Panel>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-[76px]" />)}
        </div>
      ) : people.length === 0 ? (
        <Panel className="reveal">
          <Empty icon={DoorOpen} title={search ? "No matches" : "Nobody is inside"}>
            {search ? "Try another name or employee code." : "People appear here as soon as a gate recognizes them."}
          </Empty>
        </Panel>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {people.map((person, i) => (
            <li key={person.id}>
              <Panel as="div" className="reveal flex items-center gap-4 rounded-3xl p-4" style={{ "--i": Math.min(i, 12) }}>
                <div className="relative">
                  <Avatar name={person.full_name} className="size-11" />
                  <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full bg-info ring-2 ring-ink" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-fg">{person.full_name}</p>
                  <p className="truncate text-[13px] text-fg-3">
                    {person.employee_code}
                    {person.department ? ` · ${person.department}` : ""}
                  </p>
                </div>
                <div className="text-right">
                  <p className="tabular text-sm text-fg">{fmtTime(person.checked_in_at)}</p>
                  <p className="text-xs text-fg-3">{person.gate_name ?? timeAgo(person.checked_in_at)}</p>
                </div>
              </Panel>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
