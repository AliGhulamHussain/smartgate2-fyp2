const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.ALERTS_DATABASE_URL,
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

// Records who did what. `db` is the pool or a transaction client.
async function audit(db, req, action, entityType, entityId, details = null) {
  await db.query(
    `INSERT INTO alerts.audit_logs
       (organization_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [req.user.organization_id, req.user.id, action, entityType, entityId, details]
  );
}

module.exports = { pool, transaction, audit };
