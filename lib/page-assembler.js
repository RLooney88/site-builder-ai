/**
 * Page Assembly Service
 * Assembles full HTML pages from templates + content
 */

/**
 * Assemble a full HTML page from templates and content
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} pageId - Page ID (UUID)
 * @returns {Promise<string>} - Full HTML page
 */
export async function assemblePage(pool, pageId) {
  // Get page record
  const pageResult = await pool.query(
    'SELECT * FROM pages WHERE id = $1',
    [pageId]
  );

  if (pageResult.rows.length === 0) {
    throw new Error(`Page not found: ${pageId}`);
  }

  const page = pageResult.rows[0];

  // Get page template
  const templateResult = await pool.query(
    'SELECT * FROM page_templates WHERE id = $1',
    [page.template_id]
  );

  if (templateResult.rows.length === 0) {
    throw new Error(`Page template not found: ${page.template_id}`);
  }

  const template = templateResult.rows[0];

  // Get header template
  const headerResult = await pool.query(
    'SELECT content FROM templates WHERE id = $1',
    [template.header_template_id]
  );

  if (headerResult.rows.length === 0) {
    throw new Error(`Header template not found: ${template.header_template_id}`);
  }

  const header = headerResult.rows[0].content;

  // Get footer template
  const footerResult = await pool.query(
    'SELECT content FROM templates WHERE id = $1',
    [template.footer_template_id]
  );

  if (footerResult.rows.length === 0) {
    throw new Error(`Footer template not found: ${template.footer_template_id}`);
  }

  const footer = footerResult.rows[0].content;

  // Assemble page: header + content + footer
  let fullPage = header + '\n' + page.content + '\n' + footer;

  // Update <title> if specified in metadata
  if (page.metadata?.title) {
    fullPage = fullPage.replace(
      /<title>[^<]*<\/title>/i,
      `<title>${escapeHtml(page.metadata.title)}</title>`
    );
  }

  // Update meta description if specified
  if (page.metadata?.description) {
    const metaDescPattern = /<meta\s+name=["']description["']\s+content=["'][^"']*["']\s*\/?>/i;
    const newMetaDesc = `<meta name="description" content="${escapeHtml(page.metadata.description)}">`;
    
    if (metaDescPattern.test(fullPage)) {
      fullPage = fullPage.replace(metaDescPattern, newMetaDesc);
    } else {
      // Add meta description if it doesn't exist
      fullPage = fullPage.replace('</head>', `  ${newMetaDesc}\n</head>`);
    }
  }

  return fullPage;
}

/**
 * Regenerate all pages that use a given template
 * Used when header/footer templates are edited
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} templateId - Template ID (UUID)
 * @returns {Promise<Array>} - Array of {pageId, path, html} objects
 */
export async function regenerateAllPagesForTemplate(pool, templateId) {
  // Find all page templates using this header/footer template
  const pageTemplatesResult = await pool.query(
    'SELECT id FROM page_templates WHERE header_template_id = $1 OR footer_template_id = $1',
    [templateId]
  );

  if (pageTemplatesResult.rows.length === 0) {
    console.log(`[regenerateAllPagesForTemplate] No page templates use template ${templateId}`);
    return [];
  }

  const pageTemplateIds = pageTemplatesResult.rows.map(t => t.id);

  // Find all pages using those page templates
  const pagesResult = await pool.query(
    'SELECT id, path FROM pages WHERE template_id = ANY($1)',
    [pageTemplateIds]
  );

  console.log(`[regenerateAllPagesForTemplate] Regenerating ${pagesResult.rows.length} pages`);

  const regenerated = [];

  for (const page of pagesResult.rows) {
    try {
      const html = await assemblePage(pool, page.id);
      regenerated.push({
        pageId: page.id,
        path: page.path,
        html
      });
    } catch (error) {
      console.error(`[regenerateAllPagesForTemplate] Failed to regenerate page ${page.path}:`, error.message);
      // Continue with other pages even if one fails
    }
  }

  return regenerated;
}

/**
 * Get page by path (useful for tool handlers)
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} siteId - Site ID
 * @param {string} path - Page path (e.g., "dist/index.html")
 * @returns {Promise<Object|null>} - Page object or null if not found
 */
export async function getPageByPath(pool, siteId, path) {
  const result = await pool.query(
    'SELECT * FROM pages WHERE site_id = $1 AND path = $2',
    [siteId, path]
  );

  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Update page content and trigger reassembly
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} pageId - Page ID
 * @param {string} newContent - New content HTML (main section only)
 * @returns {Promise<string>} - Assembled full HTML
 */
export async function updatePageContent(pool, pageId, newContent) {
  // Update content in database
  await pool.query(
    'UPDATE pages SET content = $1, updated_at = NOW() WHERE id = $2',
    [newContent, pageId]
  );

  // Reassemble and return full page
  return await assemblePage(pool, pageId);
}

/**
 * Escape HTML special characters for safe insertion into attributes/content
 */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
