const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.AUTH_DATABASE_URL,
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

module.exports = { pool, transaction };