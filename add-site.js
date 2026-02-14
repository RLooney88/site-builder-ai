import pg from 'pg';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.trim(),
  ssl: { rejectUnauthorized: false }
});

async function addSite() {
  try {
    const result = await pool.query(
      `INSERT INTO sites (id, domain, github_repo, github_token, vercel_project, config)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET
         domain = EXCLUDED.domain,
         github_repo = EXCLUDED.github_repo,
         github_token = EXCLUDED.github_token,
         vercel_project = EXCLUDED.vercel_project,
         updated_at = NOW()
       RETURNING id`,
      [
        'securethevotemd',
        'securethevotemd.com',
        'RLooney88/Secure-the-Vote',
        process.env.GITHUB_TOKEN,
        'secure-the-vote',
        JSON.stringify({ workdir: 'C:\\Users\\Roddy\\.openclaw\\workspace\\repos\\Secure-the-Vote' })
      ]
    );
    
    console.log(`✅ Site added: ${result.rows[0].id}`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Add site error:', error.message);
    process.exit(1);
  }
}

addSite();
