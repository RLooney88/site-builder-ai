import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

// Use the same connection string as the main server
const DATABASE_URL = process.env.DATABASE_URL?.trim() 
  || process.env.DATABASE_PRIVATE_URL?.trim()
  || process.env.RAILWAY_DATABASE_URL?.trim()
  || 'postgresql://postgres:xuDFleLFzoWrKvuMjcNCqFEuIjZAMriR@crossover.proxy.rlwy.net:37736/railway';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function runMigration() {
  try {
    console.log('Starting brand guide migration...');
    
    // 1. Add brand_guide column to sites table
    console.log('Adding brand_guide column to sites table...');
    await pool.query(`
      ALTER TABLE sites 
      ADD COLUMN IF NOT EXISTS brand_guide JSONB DEFAULT '{}'::jsonb
    `);
    console.log('✓ Column added');
    
    // 2. Create chat_attachments table for Feature 3
    console.log('Creating chat_attachments table...');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chat_attachments (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(255),
        site_id VARCHAR(255) REFERENCES sites(id) ON DELETE CASCADE,
        filename VARCHAR(500),
        mimetype VARCHAR(100),
        size INTEGER,
        storage_key TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '30 days')
      )
    `);
    console.log('✓ Table created');
    
    // 3. Create index for efficient cleanup of expired attachments
    console.log('Creating index on chat_attachments...');
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_chat_attachments_expires 
      ON chat_attachments(expires_at) WHERE expires_at IS NOT NULL
    `);
    console.log('✓ Index created');
    
    // 4. Populate securethevotemd site with default brand guide
    console.log('Populating securethevotemd with default brand guide...');
    const defaultBrandGuide = {
      colors: {
        primary: '#1B3A5C',
        secondary: '#2C5F8A',
        accent: '#F6BF58',
        text: '#333333',
        background: '#FFFFFF'
      },
      fonts: {
        heading: 'Montserrat, sans-serif',
        body: 'Open Sans, sans-serif'
      },
      button_style: 'Rounded corners with accent color (#F6BF58) for primary CTAs, outlined style for secondary buttons',
      layout_notes: 'Uses Elementor-based layout with full-width sections. Navigation is fixed at top. Footer contains social links and contact info.',
      valid_pages: [
        '/',
        '/petition/',
        '/sign-the-petition/',
        '/contact-us/',
        '/be-an-election-judge/',
        '/citizen-action/',
        '/register-for-lobby-day-jan-27/',
        '/in-the-news/',
        '/resources/',
        '/voter-id/',
        '/voter-registration-inflation/',
        '/signature-verification/',
        '/list-maintenance/',
        '/board-compliance/',
        '/maryland-nvra-violations/',
        '/lawsuit-document/',
        '/trump-executive-order/',
        '/check-voter-registration/',
        '/press-release/'
      ]
    };
    
    const result = await pool.query(
      `UPDATE sites 
       SET brand_guide = $1 
       WHERE id = 'securethevotemd' AND (brand_guide IS NULL OR brand_guide = '{}'::jsonb)
       RETURNING id`,
      [JSON.stringify(defaultBrandGuide)]
    );
    
    if (result.rowCount > 0) {
      console.log('✓ Default brand guide added to securethevotemd');
    } else {
      console.log('ℹ securethevotemd already has a brand guide or site not found');
    }
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
runMigration();
