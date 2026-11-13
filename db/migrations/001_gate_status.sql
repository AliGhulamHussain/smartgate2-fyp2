-- 001: gates can be deactivated instead of deleted (attendance logs reference them).
-- Safe to run more than once. db/init.sql already includes this column for new volumes.
--
-- Apply to an existing volume from the project root:
--   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < db/migrations/001_gate_status.sql

ALTER TABLE attendance.gates
    ADD COLUMN IF NOT EXISTS status varchar(10) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive'));
