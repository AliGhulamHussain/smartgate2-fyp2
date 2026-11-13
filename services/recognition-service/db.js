const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.RECOGNITION_DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (error) => {
  console.error("Database pool error:", error.code || error.message);
});

// All transaction queries use the same client.
async function transaction(callback) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await callback(client);

    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Returns the organization's recognition settings. The first read creates
// the row so the database defaults (threshold 0.5, liveness on) apply.
async function loadSettings(organizationId) {
  const result = await pool.query(
    `WITH created AS (
       INSERT INTO recognition.org_settings (organization_id)
       VALUES ($1)
       ON CONFLICT (organization_id) DO NOTHING
       RETURNING match_threshold, liveness_required, updated_at
     )
     SELECT ROUND(match_threshold::numeric, 3)::float8 AS match_threshold,
            liveness_required, updated_at
     FROM created
     UNION ALL
     SELECT ROUND(match_threshold::numeric, 3)::float8, liveness_required, updated_at
     FROM recognition.org_settings
     WHERE organization_id = $1`,
    [organizationId]
  );

  return result.rows[0];
}

module.exports = { pool, transaction, loadSettings };
