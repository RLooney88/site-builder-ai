-- Template System Migration
-- Creates the database schema for first-class template storage
-- Safe to run multiple times (uses IF NOT EXISTS)

-- Templates table: stores reusable header/footer/navigation components
CREATE TABLE IF NOT EXISTS templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('header', 'footer', 'navigation')),
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  variables JSONB DEFAULT '{}',
  css TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Page templates: defines layouts that combine header + footer
CREATE TABLE IF NOT EXISTS page_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  header_template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  footer_template_id UUID REFERENCES templates(id) ON DELETE SET NULL,
  content_placeholder TEXT NOT NULL DEFAULT '<main>{CONTENT}</main>',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Pages index: stores page content separately from layout
CREATE TABLE IF NOT EXISTS pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  path VARCHAR(500) NOT NULL,
  template_id UUID REFERENCES page_templates(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  metadata JSONB DEFAULT '{}',
  github_sha TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(site_id, path)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_templates_site_type ON templates(site_id, type);
CREATE INDEX IF NOT EXISTS idx_page_templates_site ON page_templates(site_id);
CREATE INDEX IF NOT EXISTS idx_pages_site ON pages(site_id);
CREATE INDEX IF NOT EXISTS idx_pages_template ON pages(template_id);

-- Comments for documentation
COMMENT ON TABLE templates IS 'Reusable HTML templates for headers, footers, and navigation';
COMMENT ON TABLE page_templates IS 'Page layouts that combine header + footer templates';
COMMENT ON TABLE pages IS 'Individual pages with content stored separately from layout';
COMMENT ON COLUMN templates.type IS 'Type of template: header, footer, or navigation';
COMMENT ON COLUMN templates.variables IS 'Editable fields in the template (e.g., {title: string, logo_url: string})';
COMMENT ON COLUMN page_templates.content_placeholder IS 'HTML showing where page content is inserted (use {CONTENT} placeholder)';
COMMENT ON COLUMN pages.content IS 'Main content HTML only - NOT the full page. Full page is assembled from template + content.';
COMMENT ON COLUMN pages.metadata IS 'Page metadata: {title: string, description: string, etc.}';
COMMENT ON COLUMN pages.github_sha IS 'SHA of the file in GitHub for efficient updates';
