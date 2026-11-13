-- ============================================================
-- SmartGate Platform - database bootstrap
-- One PostgreSQL instance, one schema per microservice.
-- Services never read each other's schemas and there are no
-- cross-schema foreign keys: they reference each other's IDs
-- and talk over REST and Redis Streams events.
-- Requires the pgvector image, e.g. pgvector/pgvector:pg16
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS attendance;
CREATE SCHEMA IF NOT EXISTS recognition;
CREATE SCHEMA IF NOT EXISTS alerts;

-- Service roles (dev passwords only; use secrets/env in real deployments)
CREATE ROLE auth_svc        LOGIN PASSWORD 'change_me_auth';
CREATE ROLE attendance_svc  LOGIN PASSWORD 'change_me_attendance';
CREATE ROLE recognition_svc LOGIN PASSWORD 'change_me_recognition';
CREATE ROLE alerts_svc      LOGIN PASSWORD 'change_me_alerts';


-- ============================================================
-- AUTH SERVICE
-- ============================================================
CREATE TABLE auth.organizations (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        varchar(150) NOT NULL,
    slug        varchar(60)  NOT NULL UNIQUE,
    plan        varchar(20)  NOT NULL DEFAULT 'free'
                CHECK (plan IN ('free', 'pro', 'enterprise')),
    status      varchar(20)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'suspended')),
    created_at  timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE auth.users (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid REFERENCES auth.organizations(id) ON DELETE CASCADE,
    full_name        varchar(100) NOT NULL,
    email            varchar(150) NOT NULL UNIQUE,
    password_hash    text NOT NULL,
    role             varchar(20) NOT NULL
                     CHECK (role IN ('super_admin', 'org_admin', 'manager', 'gate_operator', 'viewer')),
    department       varchar(100),            -- used to scope what a manager can see
    is_active        boolean NOT NULL DEFAULT true,
    last_login_at    timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    -- only super_admin has no organization
    CHECK ((role = 'super_admin' AND organization_id IS NULL)
        OR (role <> 'super_admin' AND organization_id IS NOT NULL))
);
CREATE INDEX idx_users_org ON auth.users (organization_id);

CREATE TABLE auth.refresh_tokens (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash  text NOT NULL,
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON auth.refresh_tokens (user_id);


-- ============================================================
-- ATTENDANCE SERVICE
-- ============================================================
-- One shift policy per organization (MVP decision).
CREATE TABLE attendance.org_policies (
    organization_id  uuid PRIMARY KEY,
    timezone         varchar(50) NOT NULL DEFAULT 'Asia/Karachi',
    work_start       time NOT NULL DEFAULT '09:00',
    work_end         time NOT NULL DEFAULT '17:00',
    grace_minutes    int  NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
    working_days     smallint[] NOT NULL DEFAULT '{1,2,3,4,5}',  -- ISO: 1=Mon ... 7=Sun
    auto_close_time  time NOT NULL DEFAULT '23:30',  -- forgotten check-outs are closed here
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE attendance.holidays (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    holiday_date     date NOT NULL,
    name             varchar(100) NOT NULL,
    UNIQUE (organization_id, holiday_date)
);

CREATE TABLE attendance.gates (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    name             varchar(80) NOT NULL,
    direction        varchar(10) NOT NULL DEFAULT 'both'
                     CHECK (direction IN ('entry', 'exit', 'both')),
    -- Added by db/migrations/001_gate_status.sql for existing volumes.
    status           varchar(10) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, name)
);

CREATE TABLE attendance.employees (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    employee_code    varchar(50)  NOT NULL,
    full_name        varchar(100) NOT NULL,
    email            varchar(150),
    phone            varchar(20),
    department       varchar(100),
    designation      varchar(100),
    status           varchar(10) NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'inactive')),
    presence         varchar(10) NOT NULL DEFAULT 'outside'
                     CHECK (presence IN ('inside', 'outside')),
    face_enrolled    boolean NOT NULL DEFAULT false,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (organization_id, employee_code)
);
CREATE INDEX idx_employees_org_presence ON attendance.employees (organization_id, presence);

-- Raw punch events. History is kept: deactivate employees, do not delete them.
CREATE TABLE attendance.attendance_logs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    employee_id      uuid NOT NULL REFERENCES attendance.employees(id) ON DELETE RESTRICT,
    gate_id          uuid REFERENCES attendance.gates(id),
    action           varchar(10) NOT NULL CHECK (action IN ('check_in', 'check_out')),
    status           varchar(15) NOT NULL
                     CHECK (status IN ('on_time', 'late', 'normal', 'early_leave')),
    late_by_minutes  int NOT NULL DEFAULT 0,
    confidence       real,
    source           varchar(10) NOT NULL DEFAULT 'face',   -- 'manual' reserved for post-MVP override
    logged_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_att_logs_org_time ON attendance.attendance_logs (organization_id, logged_at DESC);
CREATE INDEX idx_att_logs_emp_time ON attendance.attendance_logs (employee_id, logged_at DESC);

-- One row per employee per day. Dashboard reads this instead of scanning raw logs.
CREATE TABLE attendance.daily_attendance (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    employee_id      uuid NOT NULL REFERENCES attendance.employees(id) ON DELETE RESTRICT,
    work_date        date NOT NULL,
    first_check_in   timestamptz,
    last_check_out   timestamptz,
    total_minutes    int NOT NULL DEFAULT 0,
    late_by_minutes  int NOT NULL DEFAULT 0,
    day_status       varchar(15) NOT NULL
                     CHECK (day_status IN ('present', 'late', 'absent', 'holiday', 'weekend', 'incomplete')),
    UNIQUE (employee_id, work_date)
);
CREATE INDEX idx_daily_org_date ON attendance.daily_attendance (organization_id, work_date);


-- ============================================================
-- RECOGNITION SERVICE
-- ============================================================
CREATE TABLE recognition.face_embeddings (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    employee_id      uuid NOT NULL,            -- reference to attendance.employees (no FK across services)
    embedding        vector(128) NOT NULL,     -- face-api.js descriptor
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_embeddings_org_emp ON recognition.face_embeddings (organization_id, employee_id);

-- Optional approximate index, for the scalability benchmark (exact vs HNSW):
-- CREATE INDEX idx_embeddings_hnsw ON recognition.face_embeddings USING hnsw (embedding vector_l2_ops);

-- Match query used by the service (L2 distance, same metric as face-api.js):
--   SELECT employee_id, embedding <-> $1::vector AS distance
--   FROM recognition.face_embeddings
--   WHERE organization_id = $2
--   ORDER BY embedding <-> $1::vector
--   LIMIT 1;

CREATE TABLE recognition.org_settings (
    organization_id    uuid PRIMARY KEY,
    match_threshold    real NOT NULL DEFAULT 0.6 CHECK (match_threshold > 0),
    liveness_required  boolean NOT NULL DEFAULT true,
    updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE recognition.recognition_events (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    employee_id      uuid,                     -- null when nobody matched
    gate_id          uuid,
    distance         real,
    matched          boolean NOT NULL,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_recog_events_org_time ON recognition.recognition_events (organization_id, created_at DESC);


-- ============================================================
-- ALERTS SERVICE (unknown faces, notifications, audit)
-- ============================================================
CREATE TABLE alerts.unknown_faces (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    gate_id          uuid,
    snapshot_path    text NOT NULL,            -- file on a Docker volume, not base64 in the DB
    best_distance    real,
    status           varchar(10) NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new', 'reviewed', 'dismissed')),
    reviewed_by      uuid,
    reviewed_at      timestamptz,
    note             text,
    captured_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_unknown_org_status ON alerts.unknown_faces (organization_id, status, captured_at DESC);

CREATE TABLE alerts.notification_recipients (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    email            varchar(150) NOT NULL,
    alert_types      text[] NOT NULL DEFAULT '{unknown_face,late_arrival,forgot_checkout,daily_summary}',
    UNIQUE (organization_id, email)
);

CREATE TABLE alerts.notifications (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid NOT NULL,
    type             varchar(30) NOT NULL,
    recipient        varchar(150) NOT NULL,
    subject          text,
    payload          jsonb,
    status           varchar(10) NOT NULL DEFAULT 'queued'
                     CHECK (status IN ('queued', 'sent', 'failed')),
    error            text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    sent_at          timestamptz
);
CREATE INDEX idx_notifications_org_time ON alerts.notifications (organization_id, created_at DESC);

CREATE TABLE alerts.audit_logs (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id  uuid,
    actor_user_id    uuid,
    action           varchar(60) NOT NULL,     -- e.g. 'policy.updated', 'employee.deactivated'
    entity_type      varchar(40),
    entity_id        uuid,
    details          jsonb,
    created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_org_time ON alerts.audit_logs (organization_id, created_at DESC);


-- ============================================================
-- PERMISSIONS: each service role only touches its own schema
-- ============================================================
GRANT USAGE ON SCHEMA auth TO auth_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO auth_svc;
ALTER ROLE auth_svc SET search_path = auth, public;

GRANT USAGE ON SCHEMA attendance TO attendance_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA attendance TO attendance_svc;
ALTER ROLE attendance_svc SET search_path = attendance, public;

GRANT USAGE ON SCHEMA recognition TO recognition_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA recognition TO recognition_svc;
ALTER ROLE recognition_svc SET search_path = recognition, public;

GRANT USAGE ON SCHEMA alerts TO alerts_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA alerts TO alerts_svc;
ALTER ROLE alerts_svc SET search_path = alerts, public;







-- =========================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash
ON auth.refresh_tokens (token_hash);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
ON auth.users (LOWER(email));