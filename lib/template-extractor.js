/**
 * Template Extraction Service
 * Extracts header/footer templates from existing HTML pages
 * This runs once during site onboarding to establish templates
 */

/**
 * Detect Elementor template boundaries in HTML
 * Elementor uses data-elementor-type="wp-post" for header/footer templates
 * and data-elementor-type="wp-page" for page content
 * @param {string} html - Full HTML content
 * @returns {Object|null} - {headerEnd, footerStart} line indices, or null if not Elementor
 */
function detectElementorBoundaries(html) {
  // Look for Elementor page content marker
  const pageContentPattern = /data-elementor-type="wp-page"/;
  const match = pageContentPattern.exec(html);
  if (!match) return null;

  const pageContentIdx = match.index;

  // Find the opening div of the page content section
  // Walk backwards to find the start of this <div
  let divStart = html.lastIndexOf('<div', pageContentIdx);
  if (divStart === -1) return null;

  // Everything before this div (up to the line start) is the header
  let headerEnd = html.lastIndexOf('\n', divStart);
  if (headerEnd === -1) headerEnd = divStart;

  // Now find the footer: look for the next data-elementor-type="wp-post" AFTER the page content
  const afterContent = html.indexOf('data-elementor-type="wp-post"', pageContentIdx);
  if (afterContent === -1) {
    // No footer template found, look for closing scripts
    const bodyClose = html.lastIndexOf('</body>');
    return { headerEnd, footerStart: bodyClose > 0 ? html.lastIndexOf('\n', bodyClose) : null };
  }

  // Find the start of the footer's opening div
  let footerDivStart = html.lastIndexOf('<div', afterContent);
  let footerStart = html.lastIndexOf('\n', footerDivStart);
  if (footerStart === -1) footerStart = footerDivStart;

  return { headerEnd, footerStart };
}

/**
 * Extract header from HTML content
 * Uses multiple heuristics to find where header ends
 * @param {string} html - Full HTML content
 * @returns {string} - Extracted header HTML
 */
export function extractHeader(html) {
  // Strategy 0: Elementor detection (most reliable for WP/Elementor sites)
  const elementor = detectElementorBoundaries(html);
  if (elementor && elementor.headerEnd > 0) {
    return html.slice(0, elementor.headerEnd);
  }

  let headerEnd = -1;

  // Strategy 1: Look for <main>, role="main", id="main", etc.
  const mainPatterns = [
    '<main',
    'role="main"',
    "role='main'",
    'id="main"',
    "id='main'",
    'class="main-content"',
    'class="site-main"',
  ];

  for (const pattern of mainPatterns) {
    const idx = html.indexOf(pattern);
    if (idx !== -1) {
      headerEnd = html.lastIndexOf('\n', idx);
      if (headerEnd === -1) headerEnd = idx;
      break;
    }
  }

  // Strategy 2: Look for end of <header> tag
  if (headerEnd === -1) {
    const headerCloseIdx = html.indexOf('</header>');
    if (headerCloseIdx !== -1) {
      headerEnd = html.indexOf('\n', headerCloseIdx) + 1;
    }
  }

  // Strategy 3: Look for end of <nav> tag
  if (headerEnd === -1) {
    const navCloseIdx = html.lastIndexOf('</nav>');
    if (navCloseIdx !== -1) {
      headerEnd = html.indexOf('\n', navCloseIdx) + 1;
    }
  }

  // Strategy 4: Look for <!-- End Header --> comment
  if (headerEnd === -1) {
    const commentPatterns = [
      '<!-- End Header -->',
      '<!-- /header -->',
      '<!-- End Navigation -->'
    ];
    for (const pattern of commentPatterns) {
      const idx = html.indexOf(pattern);
      if (idx !== -1) {
        headerEnd = html.indexOf('\n', idx) + 1;
        break;
      }
    }
  }

  // Fallback: If nothing found, assume header ends after first 20% of file
  if (headerEnd === -1) {
    headerEnd = Math.floor(html.length * 0.2);
  }

  return html.slice(0, headerEnd);
}

/**
 * Extract footer from HTML content
 * Uses multiple heuristics to find where footer starts
 * @param {string} html - Full HTML content
 * @returns {string} - Extracted footer HTML
 */
export function extractFooter(html) {
  // Strategy 0: Elementor detection
  const elementor = detectElementorBoundaries(html);
  if (elementor && elementor.footerStart > 0) {
    return html.slice(elementor.footerStart);
  }

  let footerStart = -1;

  // Strategy 1: Look for <footer> tag
  const footerPatterns = [
    '<footer',
    'id="footer"',
    "id='footer'",
    'class="footer"',
    'class="site-footer"',
    'role="contentinfo"'
  ];

  for (const pattern of footerPatterns) {
    const idx = html.indexOf(pattern);
    if (idx !== -1) {
      footerStart = html.lastIndexOf('\n', idx);
      if (footerStart === -1) footerStart = idx;
      break;
    }
  }

  // Strategy 2: Look for <!-- Footer --> comment
  if (footerStart === -1) {
    const commentPatterns = [
      '<!-- Footer -->',
      '<!-- Begin Footer -->',
      '<!-- footer -->'
    ];
    for (const pattern of commentPatterns) {
      const idx = html.indexOf(pattern);
      if (idx !== -1) {
        footerStart = html.lastIndexOf('\n', idx);
        break;
      }
    }
  }

  // Strategy 3: Look for closing scripts section
  if (footerStart === -1) {
    const scriptPatterns = [
      '</body>',
      '<script src'
    ];
    for (const pattern of scriptPatterns) {
      const idx = html.lastIndexOf(pattern);
      if (idx !== -1) {
        footerStart = html.lastIndexOf('\n', idx);
        if (footerStart === -1) footerStart = idx;
        break;
      }
    }
  }

  // Fallback: If nothing found, assume footer starts at last 10% of file
  if (footerStart === -1) {
    footerStart = Math.floor(html.length * 0.9);
  }

  return html.slice(footerStart);
}

/**
 * Extract main content (everything between header and footer)
 * @param {string} html - Full HTML content
 * @param {string} header - Header HTML (from extractHeader)
 * @param {string} footer - Footer HTML (from extractFooter)
 * @returns {string} - Main content HTML
 */
export function extractMainContent(html, header, footer) {
  let content = html;

  if (header && header.length > 0) {
    content = content.replace(header, '');
  }

  if (footer && footer.length > 0) {
    content = content.replace(footer, '');
  }

  return content.trim();
}

/**
 * Extract title from HTML
 * @param {string} html - Full HTML content
 * @returns {string} - Page title or empty string
 */
export function extractTitle(html) {
  const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
  return titleMatch ? titleMatch[1].trim() : '';
}

/**
 * Run full template extraction and database setup for a site
 * This is the main onboarding function
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} siteId - Site ID
 * @param {Array} htmlFiles - Array of {path, content} objects
 * @returns {Promise<Object>} - Extraction results
 */
export async function extractAndStoreTemplates(pool, siteId, htmlFiles) {
  if (!htmlFiles || htmlFiles.length === 0) {
    throw new Error('No HTML files provided for template extraction');
  }

  console.log(`[extractAndStoreTemplates] Processing ${htmlFiles.length} files for site ${siteId}`);

  // Use the first file (usually index.html) as the reference
  const referenceFile = htmlFiles[0];
  console.log(`[extractAndStoreTemplates] Using ${referenceFile.path} as reference`);

  const header = extractHeader(referenceFile.content);
  const footer = extractFooter(referenceFile.content);

  console.log(`[extractAndStoreTemplates] Extracted header: ${header.length} chars`);
  console.log(`[extractAndStoreTemplates] Extracted footer: ${footer.length} chars`);

  // Validate that we got reasonable templates
  if (header.length < 100) {
    console.warn('[extractAndStoreTemplates] Header seems too short — extraction may have failed');
  }
  if (footer.length < 50) {
    console.warn('[extractAndStoreTemplates] Footer seems too short — extraction may have failed');
  }

  // Store header template in database
  const headerResult = await pool.query(
    `INSERT INTO templates (site_id, type, name, content, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING id`,
    [siteId, 'header', 'Site Header', header]
  );
  const headerTemplateId = headerResult.rows[0].id;

  // Store footer template in database
  const footerResult = await pool.query(
    `INSERT INTO templates (site_id, type, name, content, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING id`,
    [siteId, 'footer', 'Site Footer', footer]
  );
  const footerTemplateId = footerResult.rows[0].id;

  // Create default page template
  const pageTemplateResult = await pool.query(
    `INSERT INTO page_templates (site_id, name, header_template_id, footer_template_id, content_placeholder, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     RETURNING id`,
    [siteId, 'Default Page', headerTemplateId, footerTemplateId, '{CONTENT}']
  );
  const pageTemplateId = pageTemplateResult.rows[0].id;

  // Extract and store each page's content
  let pagesIndexed = 0;
  for (const file of htmlFiles) {
    try {
      const content = extractMainContent(file.content, header, footer);
      const title = extractTitle(file.content);

      await pool.query(
        `INSERT INTO pages (site_id, path, template_id, content, metadata, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (site_id, path) DO UPDATE SET
           content = EXCLUDED.content,
           metadata = EXCLUDED.metadata,
           template_id = EXCLUDED.template_id,
           updated_at = NOW()`,
        [
          siteId,
          file.path,
          pageTemplateId,
          content,
          JSON.stringify({ title })
        ]
      );

      pagesIndexed++;
    } catch (error) {
      console.error(`[extractAndStoreTemplates] Failed to index page ${file.path}:`, error.message);
    }
  }

  console.log(`[extractAndStoreTemplates] Successfully indexed ${pagesIndexed} pages`);

  return {
    headerTemplateId,
    footerTemplateId,
    pageTemplateId,
    pagesIndexed
  };
}
