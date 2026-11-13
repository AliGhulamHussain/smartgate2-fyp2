# SmartGate FYP-2 Project Status

Last updated: 2026-11-13

This is the living development handoff for SmartGate. Update it after every meaningful feature, schema change, API change, integration test, or newly discovered blocker.

## Project Goal

SmartGate is a multi-tenant attendance and access-monitoring platform for schools, universities, offices, and similar organizations. Its MVP records employee attendance through face recognition, calculates late arrival and current presence, maintains daily summaries, and flags unknown faces.

## MVP Scope

Included:

- Multi-tenant organizations and role-based users
- One attendance policy and shift per organization
- Employee and gate management
- Face enrollment and 128-dimensional face matching
- Automatic check-in/check-out and late-arrival calculation
- Current presence and daily attendance summaries
- Unknown-face records and alerts
- React administration dashboard and gate kiosk

Deferred:

- Multiple shifts
- Payroll and complex leave management
- Manual attendance overrides
- Advanced scheduling and exports

## Architecture

| Component | Runtime | Responsibility |
|---|---|---|
| API Gateway | Windows, `127.0.0.1:4000` | Public frontend entry point and service routing |
| Auth Service | Windows, `127.0.0.1:4001` | Organizations, users, JWTs, refresh sessions and RBAC |
| Attendance Service | Windows, `127.0.0.1:4002` | Policies, employees, gates, attendance and presence |
| Recognition Service | Planned | Embeddings, matching and recognition events |
| Alerts Service | Planned | Unknown faces, notifications and event consumption |
| PostgreSQL + pgvector | Docker, host port `5433` | Persistent service-specific schemas |
| Redis | Docker, host port `6379` | Redis Streams and asynchronous events |
| React frontend | Planned, expected port `5173` | Dashboard and gate kiosk |

Normal frontend traffic must go through the API Gateway. Internal service endpoints such as `POST /internal/punch` must not be exposed by the gateway.

## Component Status

| Component | Status | Notes |
|---|---|---|
| Docker infrastructure | Verified | PostgreSQL and Redis reachable on their configured host ports |
| PostgreSQL | Verified | Database `smartgate2`, PostgreSQL 16.15 |
| pgvector | Verified | Extension version 0.8.6 |
| Database role isolation | Verified | All four service roles can access only their own schemas |
| Redis | Verified, unused | Redis 7.4.11; zero keys and no streams yet |
| API Gateway | Implemented and live-tested | Auth, user-management and all public Attendance mappings |
| Auth Service | Implemented and live-tested | Authentication, sessions, RBAC and tenant isolation |
| Attendance Service | Partially implemented | Policy, employee, gate, punch processing and monitoring APIs completed |
| Recognition Service | Not implemented | Directory is empty; database schema exists |
| Alerts Service | Not implemented | Directory is empty; database schema exists |
| React frontend | Not implemented | Directory is empty |
| Automated tests | Started | Eighteen unit tests (validation, query parsing and punch rules) plus live integration checks |
| Documentation | In progress | This is the first repository status document |

## Database Source of Truth

The current schema is defined in `db/init.sql`. The live database contains all four schemas and 16 expected tables.

### Auth

- `auth.organizations`
- `auth.users`
- `auth.refresh_tokens`

### Attendance

- `attendance.org_policies`
- `attendance.holidays`
- `attendance.gates`
- `attendance.employees`
- `attendance.attendance_logs`
- `attendance.daily_attendance`

### Recognition

- `recognition.face_embeddings`
- `recognition.org_settings`
- `recognition.recognition_events`

### Alerts

- `alerts.unknown_faces`
- `alerts.notification_recipients`
- `alerts.notifications`
- `alerts.audit_logs`

Use these actual table names rather than shortened names from older planning documents.

## Current Local Data Snapshot

Verified on 2026-11-10:

| Data | Count |
|---|---:|
| Organizations | 3 |
| Users | 4 |
| Refresh-token records | 10 |
| Active org-admin sessions | 1 |
| Attendance policies | 0 |
| Employees | 0 |
| Gates | 0 |
| Attendance logs | 0 |
| Recognition records | 0 |
| Alert records | 0 |

These counts describe the local development volume and are not fixtures.

## Implemented Internal API (not exposed by the gateway)

- `POST /internal/punch` on the Attendance Service (`127.0.0.1:4002`), called by Recognition after a face match
  - Header `X-Internal-Key` must equal `INTERNAL_SERVICE_KEY` from `.env` (at least 32 characters; Attendance refuses to start without it)
  - Body: `organization_id`, `employee_id`, `gate_id` (UUIDs), optional `confidence` (0-1); other fields are rejected
  - `201 { recorded: true, log, employee }` when recorded; `200 { recorded: false, reason }` when ignored (`cooldown`, `already_inside`, `not_inside`)
  - `401` bad key, `400` invalid body, `404` employee/gate not in that organization, `409` inactive employee/gate or no policy

## Implemented Public API

- `GET /health`
- `POST /api/auth/signup`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/users`
- `POST /api/users`
- `PATCH /api/users/:id`
- `GET /api/attendance/policy`
- `PUT /api/attendance/policy`
- `GET /api/attendance/employees`
- `POST /api/attendance/employees`
- `GET /api/attendance/employees/:id`
- `PATCH /api/attendance/employees/:id`
- `GET /api/attendance/gates`
- `POST /api/attendance/gates`
- `GET /api/attendance/gates/:id`
- `PATCH /api/attendance/gates/:id`
- `GET /api/attendance/presence`
- `GET /api/attendance/logs`
- `GET /api/attendance/daily`
- `GET /api/attendance/stats`

Implemented Auth behavior:

- Organization signup and first `org_admin` creation in one transaction
- bcrypt password hashes
- 15-minute JWT access tokens
- Hashed, rotating 14-day refresh tokens in HttpOnly cookies
- Session revocation after security-sensitive account changes
- Active-user and active-organization enforcement
- Roles: `super_admin`, `org_admin`, `manager`, `gate_operator`, `viewer`
- Organization-scoped user management

Implemented Attendance behavior:

- Restricted `attendance_svc` database connection
- Independent bearer-session verification through Auth `/api/auth/me`
- Organization-scoped policy reads and upserts
- Policy updates restricted to `org_admin`
- IANA timezone, time, grace-minute and ISO working-day validation
- Attendance health endpoint with database connectivity check
- Organization-scoped employee create/list/get/update; every query filters by the caller's `organization_id`
- All organization roles may read employees; only `org_admin` may create or update
- Employee fields: `employee_code` (letters, digits, `.`, `_`, `-`), `full_name`, optional `email`, `phone`, `department`, `designation`; unsupported fields are rejected
- `presence` and `face_enrolled` cannot be set through CRUD (owned by punch processing and Recognition)
- Deactivation and reactivation through `PATCH` with `status`; employees are never deleted
- Duplicate `employee_code` within an organization returns `409`
- List supports `page`, `limit` (default 20, max 100), `search` (name or code), `status`, `presence` and `department`
- Organization-scoped gate create/list/get/update; all organization roles read, only `org_admin` writes
- Gate fields: `name` (required, max 80, unique per organization, `409` on duplicate), `direction` (`entry`/`exit`/`both`, default `both`); `status` only on `PATCH`
- Gates are deactivated with `status=inactive`, never deleted (attendance logs reference them)
- Gate list filters: `status`, `direction`; no pagination (organizations have few gates)

Implemented punch processing:

- Entry gates check in, exit gates check out, `both` gates toggle on current presence
- Repeat punches for the same employee within `PUNCH_COOLDOWN_SECONDS` (default 180) are ignored; the employee row is locked so simultaneous punches record once
- Times use the organization's policy timezone; a working day is a policy working day that is not in `attendance.holidays`
- Only the first check-in of a working day is judged: more than `grace_minutes` after `work_start` is `late`, and `late_by_minutes` counts from `work_start`; re-entries are `normal`; non-working days are never late
- Check-out before `work_end` on a working day is `early_leave`, otherwise `normal`
- Each check-in/out writes `attendance.attendance_logs` and updates `employees.presence`
- `attendance.daily_attendance` gets one row per employee/day on first check-in (`present` or `late`); each check-out sets `last_check_out` and adds the visit's minutes to `total_minutes`
- Forgotten check-outs: a job every minute moves employees outside once `auto_close_time` passes (or the check-in was on an earlier day) and marks that day `incomplete`; the punch path also closes such sessions first. No fake check-out log is written

Implemented monitoring (read-only, all organization roles, organization-scoped, `409` when no policy exists for `logs`/`daily`/`stats`):

- `presence`: `active_employees`, `inside` count and the inside employees with check-in time and gate name
- `logs`: punch history with employee and gate names; filters `from`/`to` (inclusive dates in the policy timezone), `employee_id`, `gate_id`, `action`, `status`; `page`, `limit` (default 50, max 200)
- `daily`: one record per employee for `date` (default today, no future dates) with `day_type` (`working`/`weekend`/`holiday`), a status `summary`, and filters `status`, `department`, `page`, `limit`. Employees without a row are `absent` on working days, otherwise `weekend`/`holiday`. Employees created after the date are excluded; inactive employees appear only if they have a row
- `stats`: today's date, `active_employees`, `inside_now`, today's present/late/incomplete/absent counts and a 7-day `trend` using the same absent rule

## Verified Runtime Behavior

Verified on 2026-11-10 without creating new application data:

- Gateway and Auth health endpoints return `200`
- Auth health confirms PostgreSQL connectivity
- Missing bearer tokens return `401`
- Malformed JSON returns `400`
- Disallowed browser origins return `403`
- Unknown routes return `404`
- Client-supplied identity headers do not bypass authentication
- Gateway forwards Auth request bodies and errors correctly
- An existing valid org-admin session can access `/api/auth/me` and `/api/users`
- Cross-organization user access returns `403`
- `/internal/punch` is not exposed by the gateway
- Each database service role is denied access to the other service schemas
- Attendance health endpoint returns `200` with database connected
- Missing attendance policy returns `404`
- Organization admin can create and retrieve a normalized policy through the gateway
- Invalid timezone and malformed policy JSON return `400`
- Viewer policy updates return `403`
- Spoofed identity headers cannot change the policy organization
- Temporary integration-test policy and session records are removed after testing

Employee management verified on 2026-11-13 through the gateway (50 live checks, all passed):

- Create, list, get and update return the expected data; new employees keep the active/outside/not-enrolled defaults
- Deactivate and reactivate work, and the status filter reflects them
- Duplicate `employee_code` returns `409` on create and update; the same code is allowed in another organization
- Invalid UUIDs, unsupported fields, `presence`/`face_enrolled`, malformed JSON and bad filters return `400`
- Missing token returns `401`; viewer writes return `403`; viewers can read
- Organization B gets `404` when reading or updating an Organization A employee, and the update is not applied
- Spoofed identity headers cannot change tenant scope or role
- Search, department, presence, status filters and pagination behave correctly; LIKE wildcards in search are literal
- Auth, policy, origin, logout and `/internal/punch` regression checks still pass
- Temporary organizations, users, sessions, policy and employees were removed; counts returned to 3 organizations, 4 users, 10 refresh tokens, 0 policies, 0 employees

Gate management verified on 2026-11-13 through the gateway (41 live checks, all passed):

- Create, list, get, rename, change direction, deactivate and reactivate work; defaults are `both`/`active`
- Duplicate gate name returns `409` on create and rename; the same name is allowed in another organization
- Bad direction/status, unsupported fields, empty updates, invalid UUIDs and malformed JSON return `400`
- Missing token `401`; viewer writes `403`; viewers can read
- Organization B gets `404` reading or updating an Organization A gate, and the update is not applied
- Spoofed identity headers cannot change tenant scope
- Employee checks (50) re-run and passed; policy, origin, logout and `/internal/punch` regressions pass
- Temporary data removed; counts returned to 3 organizations, 4 users, 10 refresh tokens and zero policies, employees and gates

Punch processing verified on 2026-11-13 (37 live checks, run twice, all passed; Attendance started with `PUNCH_COOLDOWN_SECONDS=3` for testing):

- Missing/wrong internal key `401`; the gateway returns `404` for `/internal/punch` even with the key
- Invalid body `400`; no policy `409`; inactive employee/gate `409`; employee or gate from another organization `404`
- Late first check-in (`late`, ~30 minutes), on-time check-in, holiday check-in not late
- Cooldown, entry-while-inside and exit-while-outside are ignored with reasons
- Early-leave check-out, re-entry `normal`, `both` gate toggling, presence updates
- Daily summary has one row with first/last times, total minutes and `late` status
- A forgotten check-out from the previous day is closed by the next punch (`incomplete`) and today is recorded; the background auto-close path does the same and leaves today's open sessions alone
- Five simultaneous punches for one employee record exactly one
- Employee (50) and gate (41) checks re-run and passed; Attendance refuses to start with a short internal key
- Temporary data removed; all counts returned to baseline, with zero attendance logs, daily rows and holidays

Monitoring verified on 2026-11-13 through the gateway (37 live checks, all passed):

- Missing token `401`; no policy `409`; viewers can read every monitoring endpoint
- Presence counts, inside list and gate names; organization isolation for presence, logs and stats
- Log date-range, status, employee filters and pagination; bad dates, `from` after `to` and bad UUIDs return `400`
- Daily summary for today (late, present, absent), status/department filters, pagination, inactive employees excluded
- Past dates exclude employees created later; holiday and weekend days report `holiday`/`weekend` instead of absent; future dates `400`
- Stats headline, today counts and 7-day trend (holiday not absent, no absences before employees existed)
- Employee, gate and punch suites re-run and passed; temporary data removed and counts returned to baseline

## Known Gaps and Risks

- There is no migration runner. `db/init.sql` only runs for a new PostgreSQL volume; existing volumes need each file in `db/migrations/` applied in order (each file is safe to re-run and documents its command).
- Database service-role development passwords are embedded in `db/init.sql`.
- Duplicate camera events are handled by a per-employee cooldown, not an idempotency key. A person standing at a `both` gate longer than the cooldown is toggled; the kiosk/Recognition should also debounce.
- Overnight shifts (`work_end` before `work_start`) are not supported for lateness, early-leave or work-date assignment.
- Absent, weekend and holiday days are not stored as rows; `daily` and `stats` compute them at read time. Employee activation history is not tracked, so a deactivated employee's past absences disappear from historical reports.
- `presence` is not paginated (fine for hundreds of people inside at once).
- Holidays have no API yet; rows can only be added directly in the database.
- `POST /internal/punch` uses one shared key; rotate it in `.env` for both Attendance and Recognition together.
- Redis stream names and consumer behavior are not defined.
- Gateway proxy dependencies emit a Node.js `util._extend` deprecation warning under Node 24.
- Automated unit coverage covers policy and employee validation only; live integration checks are run manually and are not yet a committed test suite.
- npm reported two moderate dependency advisories for the Attendance install; the audit endpoint was unavailable, so no forced dependency changes were applied.

## Immediate Next Task

Start the Recognition Service (`services/recognition-service`, planned port `4003`):

- Express foundation, health endpoint, restricted `recognition_svc` database connection, bearer verification through Auth
- Face enrollment: store 128-dimensional embeddings in `recognition.face_embeddings` for an Attendance employee (verify the employee through an Attendance API, never by reading the Attendance schema)
- Matching with pgvector L2 distance (`<->`) and the 0.6 default threshold, recording `recognition.recognition_events`
- On a match, call Attendance `POST /internal/punch` with `X-Internal-Key`
- Decide how `face_enrolled` on the Attendance employee is updated (an internal Attendance endpoint is the likely answer)

## Schema and Migration History

| Migration | Date | Change | Applied to local volume |
|---|---|---|---|
| `db/migrations/001_gate_status.sql` | 2026-11-13 | `attendance.gates.status` (`active`/`inactive`, default `active`); also added to `db/init.sql` | Yes |

## Remaining Roadmap

1. Completed: Attendance Service foundation and policy APIs
2. Completed: Employee CRUD and organization filtering
3. Completed: Gate CRUD and gate-status migration
4. Completed: Internal punch endpoint and duplicate protection
5. Completed: Check-in/check-out, lateness, presence and daily summaries
6. Completed: Attendance monitoring and statistics APIs
7. Recognition Service and embedding registration/matching
8. Unknown-face event flow and Alerts Service
9. React dashboard and kiosk
10. End-to-end multi-tenant testing
11. Demo data, diagrams, API documentation, report and presentation

## Update Checklist

After each meaningful task, update:

- Component Status
- Implemented Public API
- Verified Runtime Behavior
- Known Gaps and Risks
- Immediate Next Task
- Schema and migration history when applicable

Never place credentials, JWTs, refresh tokens, face images, or private employee data in this document.
