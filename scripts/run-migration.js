/**
 * Migration Runner
 * Executes database migrations safely
 * Safe to run multiple times (uses IF NOT EXISTS)
 */

import pg from 'pg';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Pool } = pg;

async function runMigration() {
  console.log('🔄 Running database migration: 001-template-system.sql');
  
  // Get database connection
  const DATABASE_URL = process.env.DATABASE_URL?.trim() 
    || process.env.DATABASE_PRIVATE_URL?.trim()
    || process.env.RAILWAY_DATABASE_URL?.trim();
  
  if (!DATABASE_URL) {
    console.error('❌ ERROR: No DATABASE_URL configured.');
    console.error('   Set DATABASE_URL environment variable and try again.');
    process.exit(1);
  }
  
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
  });
  
  try {
    // Read migration file
    const migrationPath = join(__dirname, '../migrations/001-template-system.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');
    
    console.log('📖 Read migration file:', migrationPath);
    
    // Execute migration
    await pool.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('Created tables:');
    console.log('  - templates (reusable header/footer/navigation components)');
    console.log('  - page_templates (layouts that combine header + footer)');
    console.log('  - pages (individual pages with content stored separately)');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Use lib/template-extractor.js to extract templates from existing sites');
    console.log('  2. Use lib/page-assembler.js to assemble pages from templates + content');
    console.log('  3. Update server.js tools to use the new template system');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('');
    console.error('Error details:');
    console.error(error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
runMigration();
