import pg from 'pg';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.trim(),
  ssl: { rejectUnauthorized: false }
});

const schema = fs.readFileSync('schema.sql', 'utf8');

async function init() {
  try {
    await pool.query(schema);
    console.log('✅ Database initialized');
    process.exit(0);
  } catch (error) {
    console.error('❌ Database init error:', error.message);
    process.exit(1);
  }
}

init();
