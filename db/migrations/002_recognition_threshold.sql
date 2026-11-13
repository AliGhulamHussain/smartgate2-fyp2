-- 002: stricter default face-match threshold (0.6 -> 0.5). The face-api.js
-- default of 0.6 confuses similar-looking people; organizations can still
-- tune it through PUT /api/recognition/settings.
-- Safe to run more than once. db/init.sql already uses 0.5 for new volumes.
--
-- Apply to an existing volume from the project root:
--   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1' < db/migrations/002_recognition_threshold.sql

ALTER TABLE recognition.org_settings
    ALTER COLUMN match_threshold SET DEFAULT 0.5;
