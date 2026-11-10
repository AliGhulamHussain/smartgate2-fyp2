# SmartGate FYP-2 Project Status

Last updated: 2026-11-10

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
| Attendance Service | Planned, port `4002` | Policies, employees, gates, attendance and presence |
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
| API Gateway | Implemented and live-tested | Auth and user-management mappings only |
| Auth Service | Implemented and live-tested | Authentication, sessions, RBAC and tenant isolation |
| Attendance Service | Not implemented | Directory is empty; database schema exists |
| Recognition Service | Not implemented | Directory is empty; database schema exists |
| Alerts Service | Not implemented | Directory is empty; database schema exists |
| React frontend | Not implemented | Directory is empty |
| Automated tests | Missing | Current verification is manual/live API testing |
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

Implemented Auth behavior:

- Organization signup and first `org_admin` creation in one transaction
- bcrypt password hashes
- 15-minute JWT access tokens
- Hashed, rotating 14-day refresh tokens in HttpOnly cookies
- Session revocation after security-sensitive account changes
- Active-user and active-organization enforcement
- Roles: `super_admin`, `org_admin`, `manager`, `gate_operator`, `viewer`
- Organization-scoped user management

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

## Known Gaps and Risks

- There is no migration system; `db/init.sql` only runs automatically for a new PostgreSQL volume.
- `.env.example` needs gateway and future-service variables and still uses the old `smartgate` database name.
- `FRONTEND_ORIGIN` is duplicated in the local `.env`.
- Database service-role development passwords are embedded in `db/init.sql`.
- Gates have no active/inactive column although the roadmap requests gate deactivation.
- Attendance logs have no recognition-event idempotency key; duplicate camera events need an explicit strategy.
- No internal service authentication mechanism exists for `POST /internal/punch`.
- Redis stream names and consumer behavior are not defined.
- Gateway proxy dependencies emit a Node.js `util._extend` deprecation warning under Node 24.
- No automated regression tests exist.

## Immediate Next Task

Implement the Attendance Service foundation and organization-policy slice.

Planned endpoints:

- Attendance Service `GET /health`
- `GET /api/attendance/policy`
- `PUT /api/attendance/policy`

Requirements:

- Use `ATTENDANCE_DATABASE_URL` and the restricted `attendance_svc` role.
- Authenticate bearer tokens through Auth `/api/auth/me`.
- Enforce organization identity in backend queries.
- Allow authenticated organization users to view policy.
- Allow only appropriate administrators to update policy.
- Validate timezone, shift times, grace minutes, working days and auto-close time.
- Upsert `attendance.org_policies` with parameterized SQL.
- Route public requests through the API Gateway.
- Add live endpoint and tenant-isolation checks.
- Re-run Auth and Gateway regression checks.

No schema migration is required for this slice.

## Remaining Roadmap

1. Attendance policy APIs
2. Employee CRUD and organization filtering
3. Gate CRUD and gate-status schema decision
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
