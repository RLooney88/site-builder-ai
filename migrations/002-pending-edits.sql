-- Pending Edits Migration
-- Creates the database schema for buffering AI edits before they're pushed to GitHub
-- Safe to run multiple times (uses IF NOT EXISTS)

-- Pending edits table: stores AI edits in the database before they're committed to GitHub staging
CREATE TABLE IF NOT EXISTS pending_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  session_id TEXT,
  file_path TEXT NOT NULL,
  content TEXT NOT NULL,
  change_description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  pushed_at TIMESTAMPTZ,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'pushed', 'discarded')),
  UNIQUE(site_id, file_path, status)
);

-- Index for fast lookups when pushing edits to staging
CREATE INDEX IF NOT EXISTS idx_pending_edits_site_status ON pending_edits(site_id, status);
CREATE INDEX IF NOT EXISTS idx_pending_edits_session ON pending_edits(session_id);

-- Comments for documentation
COMMENT ON TABLE pending_edits IS 'Stores AI edits in the database before they are committed to GitHub staging branch';
COMMENT ON COLUMN pending_edits.site_id IS 'Reference to the site being edited';
COMMENT ON COLUMN pending_edits.session_id IS 'Chat session that made this edit';
COMMENT ON COLUMN pending_edits.file_path IS 'Path to the file in the repository (e.g., dist/index.html)';
COMMENT ON COLUMN pending_edits.content IS 'Full file content after the edit';
COMMENT ON COLUMN pending_edits.change_description IS 'Description of what changed (for the commit message)';
COMMENT ON COLUMN pending_edits.status IS 'Status: pending (not pushed yet), pushed (committed to GitHub), discarded (user reverted)';
COMMENT ON COLUMN pending_edits.pushed_at IS 'Timestamp when this edit was pushed to GitHub staging (null if still pending)';

-- Note: The UNIQUE constraint ensures only one pending edit per file path per site
-- If the AI edits the same file multiple times, it UPDATEs the pending edit rather than creating duplicates
