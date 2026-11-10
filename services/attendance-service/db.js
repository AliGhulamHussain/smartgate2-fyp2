const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.ATTENDANCE_DATABASE_URL,
  max: 10,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
});

pool.on("error", (error) => {
  console.error("Database pool error:", error.code || error.message);
});

module.exports = { pool };
