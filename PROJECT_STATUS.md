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
| API Gateway | Implemented and live-tested | Auth, user-management, attendance-policy, employee and gate mappings |
| Auth Service | Implemented and live-tested | Authentication, sessions, RBAC and tenant isolation |
| Attendance Service | Partially implemented | Foundation, health check, policy, employee and gate APIs completed |
| Recognition Service | Not implemented | Directory is empty; database schema exists |
| Alerts Service | Not implemented | Directory is empty; database schema exists |
| React frontend | Not implemented | Directory is empty |
| Automated tests | Started | Eleven unit tests (policy, employee and gate validation) plus live integration checks |
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

## Known Gaps and Risks

- There is no migration runner. `db/init.sql` only runs for a new PostgreSQL volume; existing volumes need each file in `db/migrations/` applied in order (each file is safe to re-run and documents its command).
- Database service-role development passwords are embedded in `db/init.sql`.
- Attendance logs have no recognition-event idempotency key; duplicate camera events need an explicit strategy.
- No internal service authentication mechanism exists for `POST /internal/punch`.
- Redis stream names and consumer behavior are not defined.
- Gateway proxy dependencies emit a Node.js `util._extend` deprecation warning under Node 24.
- Automated unit coverage covers policy and employee validation only; live integration checks are run manually and are not yet a committed test suite.
- npm reported two moderate dependency advisories for the Attendance install; the audit endpoint was unavailable, so no forced dependency changes were applied.

## Immediate Next Task

Implement the internal punch endpoint in the Attendance Service: `POST /internal/punch`.

- Called only by the Recognition Service, never mapped through the gateway.
- Needs an internal service-authentication decision (for example a shared secret header from `.env`).
- Needs a duplicate-event strategy (attendance logs have no recognition-event idempotency key; decide on a cooldown window or a migration adding a key).
- Must reject inactive employees and inactive gates, and verify both belong to the same organization.

## Schema and Migration History

| Migration | Date | Change | Applied to local volume |
|---|---|---|---|
| `db/migrations/001_gate_status.sql` | 2026-11-13 | `attendance.gates.status` (`active`/`inactive`, default `active`); also added to `db/init.sql` | Yes |

## Remaining Roadmap

1. Completed: Attendance Service foundation and policy APIs
2. Completed: Employee CRUD and organization filtering
3. Completed: Gate CRUD and gate-status migration
4. Internal punch endpoint and duplicate protection
5. Check-in/check-out, lateness, presence and daily summaries
6. Attendance monitoring and statistics APIs
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
