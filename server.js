import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import crypto from 'crypto';
import fs from 'fs/promises';
import multer from 'multer';
import dotenv from 'dotenv';
import { generateJWT, getCMSBaseURL, generateAdminJWT, verifyJWT } from './lib/jwt.js';
import { getStagingPreviewURL, publishToProduction, updateFile } from './lib/github.js';
import { buildSystemPrompt } from './lib/prompts/context.js';
import { assemblePage, regenerateAllPagesForTemplate, getPageByPath, updatePageContent } from './lib/page-assembler.js';
import { extractAndStoreTemplates, extractHeader, extractFooter, extractMainContent } from './lib/template-extractor.js';

// ============================================================
// Storage Abstraction Layer (Swappable for Google Drive)
// ============================================================

/**
 * Upload a file to storage. Currently uses GitHub, swappable for Google Drive.
 * @param {Object} site - Site object with github_repo and github_token
 * @param {string} siteId - Site identifier for folder organization
 * @param {Object} file - Multer file object
 * @returns {Promise<Object>} - { url, path, name, size }
 */
async function uploadFileToStorage(site, siteId, file) {
  const now = new Date();
  const year = String(now.getFullYear());
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const uploadPath = `dist/uploads/${siteId}/${year}/${month}/${file.originalname}`;
  
  // Commit file to GitHub staging branch (direct API to avoid double-base64)
  const [owner, repoName] = site.github_repo.split('/');
  const fileBase64 = file.buffer.toString('base64');
  
  const ghResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/contents/${uploadPath}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${site.github_token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Upload: ${file.originalname}`,
        content: fileBase64,
        branch: 'staging'
      })
    }
  );
  
  if (!ghResponse.ok) {
    const ghError = await ghResponse.json();
    throw new Error(`GitHub upload failed: ${ghError.message}`);
  }
  
  // Return the public URL path
  const publicUrl = `/uploads/${siteId}/${year}/${month}/${file.originalname}`;
  
  return {
    url: publicUrl,
    path: uploadPath,
    name: file.originalname,
    size: file.size,
    type: file.mimetype
  };
}

/**
 * List files for a site from storage.
 * @param {Object} site - Site object with github_repo and github_token
 * @param {string} siteId - Site identifier for folder filtering
 * @returns {Promise<Array>} - Array of { name, path, url, size, sha }
 */
async function listSiteFiles(site, siteId) {
  const [owner, repoName] = site.github_repo.split('/');
  const files = [];
  
  try {
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/trees/staging:dist/uploads?recursive=1`,
      {
        headers: {
          'Authorization': `Bearer ${site.github_token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    
    if (treeResponse.ok) {
      const treeData = await treeResponse.json();
      const prefix = `dist/uploads/${siteId}/`;
      
      for (const item of treeData.tree || []) {
        if (item.type === 'blob' && item.path.startsWith(prefix)) {
          const relativePath = item.path.slice(prefix.length);
          const pathParts = relativePath.split('/');
          const year = pathParts[0];
          const month = pathParts[1];
          const filename = pathParts.slice(2).join('/');
          
          files.push({
            name: filename,
            path: item.path,
            url: `/uploads/${siteId}/${year}/${month}/${filename}`,
            size: item.size,
            sha: item.sha
          });
        }
      }
      
      files.sort((a, b) => b.path.localeCompare(a.path));
    }
  } catch (treeError) {
    console.warn('Could not fetch uploads tree:', treeError.message);
  }
  
  return files;
}

// ============================================================
// End Storage Abstraction Layer
// ============================================================

// ============================================================
// Template Rendering System
// ============================================================

/**
 * Render a content template with data and brand variables
 * @param {string} templateHtml - Template HTML with {{variable}} placeholders
 * @param {Object} data - Data object with variable values
 * @param {Object} brandGuide - Brand guide from site.brand_guide
 * @returns {string} - Rendered HTML
 */
function renderTemplate(templateHtml, data, brandGuide = {}) {
  let rendered = templateHtml;
  
  // First, replace brand variables ({{brand.colors.primary}}, etc.)
  if (brandGuide.colors) {
    for (const [colorName, colorValue] of Object.entries(brandGuide.colors)) {
      const placeholder = new RegExp(`\\{\\{brand\\.colors\\.${colorName}\\}\\}`, 'g');
      rendered = rendered.replace(placeholder, colorValue);
    }
  }
  
  if (brandGuide.fonts) {
    for (const [fontName, fontValue] of Object.entries(brandGuide.fonts)) {
      const placeholder = new RegExp(`\\{\\{brand\\.fonts\\.${fontName}\\}\\}`, 'g');
      rendered = rendered.replace(placeholder, fontValue);
    }
  }
  
  if (brandGuide.button_style) {
    rendered = rendered.replace(/\{\{brand\.button_style\}\}/g, brandGuide.button_style);
  }
  
  // Next, replace data variables ({{title}}, {{description}}, etc.)
  for (const [key, value] of Object.entries(data)) {
    const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    rendered = rendered.replace(placeholder, String(value));
  }
  
  // Handle conditional sections ({{#key}}...{{/key}})
  // Simple implementation: remove section if key is falsy, keep content if truthy
  const conditionalPattern = /\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g;
  rendered = rendered.replace(conditionalPattern, (match, key, content) => {
    return data[key] ? content : '';
  });
  
  return rendered;
}

// ============================================================
// End Template Rendering System
// ============================================================

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// Serve Themis admin dashboard and marketing site
app.use('/themis', express.static(join(__dirname, 'themis')));
app.use((req, res, next) => {
  const host = req.hostname;
  // app.themissites.com → Themis dashboard
  if (host === 'app.themissites.com' && !req.path.startsWith('/sites') && !req.path.startsWith('/auth')) {
    return express.static(join(__dirname, 'themis'))(req, res, next);
  }
  // themissites.com (root) → marketing site
  if ((host === 'themissites.com' || host === 'www.themissites.com') && !req.path.startsWith('/sites') && !req.path.startsWith('/auth')) {
    return express.static(join(__dirname, 'marketing'))(req, res, next);
  }
  next();
});
const PORT = process.env.PORT || 3000;

// Database setup
const { Pool } = pg;
// Railway DATABASE_URL from environment, with fallback for Railway deployments
const DATABASE_URL = process.env.DATABASE_URL?.trim() 
  || process.env.DATABASE_PRIVATE_URL?.trim()
  || process.env.RAILWAY_DATABASE_URL?.trim();

if (!DATABASE_URL) {
  console.error('FATAL: No DATABASE_URL configured. Set DATABASE_URL environment variable.');
}
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false
});

// Claude API
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  if (req.path === '/health') return next(); // Skip health checks
  const start = Date.now();
  console.log(`→ ${req.method} ${req.path}`);
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`← ${req.method} ${req.path} ${res.statusCode} (${duration}ms)`);
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ============================================================
// Site Management Endpoints (for Aster/admin API access)
// ============================================================

// GET /sites - List all sites
app.get('/sites', async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, domain, github_repo, vercel_project, vercel_project_id, created_at FROM sites ORDER BY created_at DESC'
    );
    res.json({ sites: result.rows });
  } catch (error) {
    console.error('List sites error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /sites/:siteId - Get site details
app.get('/sites/:siteId', async (req, res) => {
  try {
    const { siteId } = req.params;
    const result = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = result.rows[0];
    // Mask sensitive tokens in response
    const safe = {
      id: site.id,
      domain: site.domain,
      github_repo: site.github_repo,
      github_token: site.github_token ? '***' + site.github_token.slice(-6) : null,
      vercel_project: site.vercel_project,
      vercel_project_id: site.vercel_project_id,
      vercel_token: site.vercel_token ? '***' + site.vercel_token.slice(-6) : null,
      config: site.config,
      created_at: site.created_at
    };
    res.json(safe);
  } catch (error) {
    console.error('Get site error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /sites/:siteId/pages - List files in repo (for knowing what content exists)
app.get('/sites/:siteId/pages', async (req, res) => {
  try {
    const { siteId } = req.params;
    const result = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = result.rows[0];
    if (!site.github_repo || !site.github_token) {
      return res.status(400).json({ error: 'Site does not have GitHub configured' });
    }

    const [owner, repoName] = site.github_repo.split('/');
    const branch = req.query.branch || 'staging';
    
    // Get the file tree from GitHub
    const treeResponse = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/trees/${branch}?recursive=1`,
      {
        headers: {
          'Authorization': `Bearer ${site.github_token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );

    if (!treeResponse.ok) {
      const err = await treeResponse.json();
      return res.status(treeResponse.status).json({ error: err.message });
    }

    const treeData = await treeResponse.json();
    
    // Filter to interesting files (HTML, CSS, JS, images)
    const pages = [];
    const assets = [];
    for (const item of treeData.tree || []) {
      if (item.type !== 'blob') continue;
      if (item.path.startsWith('dist/') && item.path.endsWith('.html')) {
        pages.push({ path: item.path, size: item.size });
      } else if (item.path.startsWith('dist/css/') || item.path.startsWith('dist/js/')) {
        assets.push({ path: item.path, size: item.size });
      }
    }

    res.json({ pages, assets, totalFiles: treeData.tree?.length || 0 });
  } catch (error) {
    console.error('List pages error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Brand Guide Endpoints (Feature 1)
// ============================================================

// GET /sites/:siteId/brand - Get brand guide
app.get('/sites/:siteId/brand', async (req, res) => {
  try {
    const { siteId } = req.params;
    const result = await pool.query('SELECT brand_guide FROM sites WHERE id = $1', [siteId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const brandGuide = result.rows[0].brand_guide || {};
    res.json(brandGuide);
  } catch (error) {
    console.error('Get brand guide error:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /sites/:siteId/brand - Update brand guide
app.put('/sites/:siteId/brand', async (req, res) => {
  try {
    const { siteId } = req.params;
    const brandGuide = req.body;
    
    // Validate that it's a valid JSON object
    if (!brandGuide || typeof brandGuide !== 'object') {
      return res.status(400).json({ error: 'Brand guide must be a JSON object' });
    }
    
    const result = await pool.query(
      'UPDATE sites SET brand_guide = $1, updated_at = NOW() WHERE id = $2 RETURNING id',
      [JSON.stringify(brandGuide), siteId]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    console.log(`Brand guide updated for site: ${siteId}`);
    res.json({ success: true, brandGuide });
  } catch (error) {
    console.error('Update brand guide error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sites/:siteId/brand/scan - Auto-generate brand guide from CSS/HTML
app.post('/sites/:siteId/brand/scan', async (req, res) => {
  try {
    const { siteId } = req.params;
    const result = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = result.rows[0];
    
    if (!site.github_repo || !site.github_token) {
      return res.status(400).json({ error: 'Site does not have GitHub configured' });
    }
    
    const [owner, repoName] = site.github_repo.split('/');
    const token = site.github_token;
    
    console.log(`Scanning site for brand info: ${siteId}`);
    
    // Scan CSS files for colors and patterns
    const colors = { primary: '', secondary: '', accent: '', text: '', background: '' };
    const fonts = { heading: '', body: '' };
    let buttonStyle = '';
    let layoutNotes = '';
    const validPages = [];
    
    try {
      // Get CSS files from dist/css/
      const cssResp = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/contents/dist/css?ref=staging`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
      );
      
      if (cssResp.ok) {
        const cssFiles = await cssResp.json();
        
        // Look for main CSS file (style.css, elementor.css, etc.)
        const mainCss = cssFiles.find(f => f.name.includes('style') || f.name.includes('elementor') || f.name === 'main.css');
        
        if (mainCss) {
          const cssContentResp = await fetch(mainCss.download_url);
          const cssContent = await cssContentResp.text();
          
          // Extract colors (look for hex codes in CSS)
          const hexPattern = /#[0-9A-Fa-f]{6}/g;
          const foundColors = [...new Set(cssContent.match(hexPattern) || [])].slice(0, 10);
          
          if (foundColors.length >= 3) {
            colors.primary = foundColors[0];
            colors.secondary = foundColors[1];
            colors.accent = foundColors[2];
          }
          colors.text = '#333333';
          colors.background = '#FFFFFF';
          
          // Extract fonts
          const fontPattern = /font-family:\s*([^;]+);/gi;
          const fontMatches = cssContent.match(fontPattern) || [];
          if (fontMatches.length > 0) {
            const firstFont = fontMatches[0].replace('font-family:', '').replace(';', '').trim();
            fonts.heading = firstFont;
            fonts.body = fontMatches[1] ? fontMatches[1].replace('font-family:', '').replace(';', '').trim() : firstFont;
          }
          
          // Detect button patterns
          if (cssContent.includes('border-radius')) {
            buttonStyle = 'Rounded corners';
          }
          if (cssContent.includes('.btn') || cssContent.includes('button')) {
            buttonStyle += buttonStyle ? ', uses .btn classes' : 'Uses .btn classes';
          }
        }
      }
      
      // Get index.html to understand layout
      const indexResp = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/contents/dist/index.html?ref=staging`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
      );
      
      if (indexResp.ok) {
        const indexData = await indexResp.json();
        const indexContent = Buffer.from(indexData.content, 'base64').toString('utf-8');
        
        // Detect layout framework
        if (indexContent.includes('elementor')) {
          layoutNotes = 'Built with Elementor page builder';
        } else if (indexContent.includes('bootstrap')) {
          layoutNotes = 'Uses Bootstrap framework';
        } else {
          layoutNotes = 'Custom layout';
        }
      }
      
      // Get list of valid pages
      const pagesResp = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/contents/dist?ref=staging`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
      );
      
      if (pagesResp.ok) {
        const items = await pagesResp.json();
        validPages.push('/'); // Homepage always exists
        
        for (const item of items) {
          if (item.type === 'dir' && item.name !== 'css' && item.name !== 'js' && item.name !== 'images' && item.name !== 'uploads') {
            validPages.push(`/${item.name}/`);
          }
        }
      }
      
    } catch (scanError) {
      console.warn('Error during brand scan:', scanError.message);
    }
    
    // Build brand guide object
    const scannedBrandGuide = {
      colors,
      fonts,
      button_style: buttonStyle || 'Not detected',
      layout_notes: layoutNotes || 'Not detected',
      valid_pages: validPages.length > 0 ? validPages : ['/']
    };
    
    // Save to database
    await pool.query(
      'UPDATE sites SET brand_guide = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(scannedBrandGuide), siteId]
    );
    
    console.log(`Brand guide scanned and saved for ${siteId}:`, scannedBrandGuide);
    res.json({ success: true, brandGuide: scannedBrandGuide });
    
  } catch (error) {
    console.error('Brand scan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sites/:siteId/cache-layout — Extract and cache header/footer from a reference page
app.post('/sites/:siteId/cache-layout', async (req, res) => {
  try {
    const { siteId } = req.params;
    const referencePage = req.body.page || 'dist/index.html';
    
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) return res.status(404).json({ error: 'Site not found' });
    const site = siteResult.rows[0];
    
    const [owner, repoName] = site.github_repo.split('/');
    const resp = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${referencePage}?ref=main`,
      { headers: { 'Authorization': `Bearer ${site.github_token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (!resp.ok) return res.status(400).json({ error: 'Could not read reference page' });
    const data = await resp.json();
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    
    // Extract header (everything up to main content)
    const { header, footer } = extractHeaderFooter(content);
    
    await pool.query(
      'UPDATE sites SET cached_header = $1, cached_footer = $2 WHERE id = $3',
      [header, footer, siteId]
    );
    
    console.log(`[Cache] Layout cached for ${siteId}: header=${header.length} chars, footer=${footer.length} chars`);
    res.json({ success: true, headerLength: header.length, footerLength: footer.length });
  } catch (error) {
    console.error('Cache layout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sites/:siteId/onboard — Extract templates and index pages for template system
app.post('/sites/:siteId/onboard', async (req, res) => {
  try {
    const { siteId } = req.params;
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    if (!site.github_repo || !site.github_token) {
      return res.status(400).json({ error: 'Site does not have GitHub configured' });
    }
    
    console.log(`[Onboard] Starting template extraction for site: ${siteId} (${site.domain})`);
    
    const [owner, repoName] = site.github_repo.split('/');
    const token = site.github_token;
    
    // Fetch all HTML files from dist/ directory
    const htmlFiles = [];
    
    async function fetchHtmlFiles(path = 'dist') {
      const resp = await fetch(
        `https://api.github.com/repos/${owner}/${repoName}/contents/${path}?ref=main`,
        { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
      );
      
      if (!resp.ok) {
        console.warn(`[Onboard] Could not fetch ${path}`);
        return;
      }
      
      const items = await resp.json();
      
      for (const item of items) {
        if (item.type === 'file' && item.name.endsWith('.html')) {
          // Fetch file content
          const fileResp = await fetch(item.download_url);
          const content = await fileResp.text();
          htmlFiles.push({ path: item.path, content });
          console.log(`[Onboard] Fetched: ${item.path} (${(item.size / 1024).toFixed(1)} KB)`);
        } else if (item.type === 'dir' && !['css', 'js', 'images', 'uploads', 'fonts'].includes(item.name)) {
          // Recurse into subdirectories (skip asset folders)
          await fetchHtmlFiles(item.path);
        }
      }
    }
    
    await fetchHtmlFiles();
    
    if (htmlFiles.length === 0) {
      return res.status(400).json({ error: 'No HTML files found in repository' });
    }
    
    console.log(`[Onboard] Found ${htmlFiles.length} HTML files. Extracting templates...`);
    
    // Extract and store templates
    const result = await extractAndStoreTemplates(pool, siteId, htmlFiles);
    
    console.log(`[Onboard] Template extraction complete for ${siteId}:`, result);
    
    res.json({
      success: true,
      headerTemplateId: result.headerTemplateId,
      footerTemplateId: result.footerTemplateId,
      pageTemplateId: result.pageTemplateId,
      pagesIndexed: result.pagesIndexed,
      message: `Template system initialized. ${result.pagesIndexed} pages indexed and ready for editing.`
    });
    
  } catch (error) {
    console.error('[Onboard] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper: extract header and footer from full HTML page
function extractHeaderFooter(content) {
  let headerEnd = -1;
  let footerStart = -1;
  
  // Find end of header/nav
  const headerPatterns = ['<main', 'role="main"', 'id="main"', 'class="main"', 'id="content"', 'class="site-main"', 'elementor-section-wrap'];
  for (const p of headerPatterns) {
    const idx = content.indexOf(p);
    if (idx !== -1) {
      headerEnd = content.lastIndexOf('\n', idx) + 1;
      break;
    }
  }
  if (headerEnd === -1) {
    const navEnd = content.lastIndexOf('</nav>');
    const headerEndTag = content.lastIndexOf('</header>');
    headerEnd = Math.max(navEnd, headerEndTag);
    if (headerEnd !== -1) headerEnd = content.indexOf('\n', headerEnd) + 1;
  }
  if (headerEnd === -1) headerEnd = 0;
  
  // Find start of footer
  const footerPatterns = ['<footer', 'id="footer"', 'class="footer"', 'class="site-footer"'];
  for (const p of footerPatterns) {
    const idx = content.indexOf(p, headerEnd);
    if (idx !== -1) {
      footerStart = content.lastIndexOf('\n', idx) + 1;
      break;
    }
  }
  if (footerStart === -1) {
    footerStart = content.lastIndexOf('</body>');
    if (footerStart === -1) footerStart = content.length;
  }
  
  return {
    header: content.slice(0, headerEnd),
    footer: content.slice(footerStart)
  };
}

// GET /sites/:siteId/layout — Get cached header/footer
app.get('/sites/:siteId/layout', async (req, res) => {
  try {
    const { siteId } = req.params;
    const result = await pool.query('SELECT cached_header, cached_footer FROM sites WHERE id = $1', [siteId]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Site not found' });
    const { cached_header, cached_footer } = result.rows[0];
    res.json({ 
      cached: !!(cached_header && cached_footer),
      headerLength: cached_header?.length || 0,
      footerLength: cached_footer?.length || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================

// Get or create session
async function getSession(siteId) {
  const result = await pool.query(
    'SELECT * FROM sessions WHERE site_id = $1 ORDER BY updated_at DESC LIMIT 1',
    [siteId]
  );
  
  if (result.rows.length > 0) {
    return result.rows[0];
  }
  
  // Create new session
  const sessionId = `${siteId}-${Date.now()}`;
  await pool.query(
    'INSERT INTO sessions (id, site_id) VALUES ($1, $2)',
    [sessionId, siteId]
  );
  
  return { id: sessionId, site_id: siteId, context_summary: null };
}

// Get chat history
async function getChatHistory(sessionId, limit = 20) {
  const result = await pool.query(
    'SELECT role, content FROM messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2',
    [sessionId, limit]
  );
  return result.rows.reverse();
}

// Save message
async function saveMessage(sessionId, role, content) {
  await pool.query(
    'INSERT INTO messages (session_id, role, content) VALUES ($1, $2, $3)',
    [sessionId, role, content]
  );
}

// System prompt now built by lib/prompts/context.js (modular, token-efficient)
// See buildSystemPrompt(site, pool, tools) for the new implementation

// POST /sites/:siteId/chat
app.post('/sites/:siteId/chat', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { message, images } = req.body;

    if (!message && (!images || images.length === 0)) {
      return res.status(400).json({ error: 'Message or images are required' });
    }
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    // Get or create session
    const session = await getSession(siteId);
    
    // Get chat history
    const history = await getChatHistory(session.id);
    
    // Save user message
    await saveMessage(session.id, 'user', message);
    
    // Generate JWT token for CMS API access
    const cmsApiUrl = getCMSBaseURL(site);
    const jwtToken = generateJWT(site.config || {});
    
    // Build messages for Claude
    // Include images as vision content blocks if provided
    const userContent = [];
    if (message) {
      userContent.push({ type: 'text', text: message });
    }
    if (images && images.length > 0) {
      for (const imageUrl of images) {
        userContent.push({
          type: 'image',
          source: {
            type: 'url',
            url: imageUrl
          }
        });
      }
    }

    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: userContent }
    ];
    
    // Define tools for Claude to use
    const tools = [
      {
        name: 'read_file',
        description: 'Read a file from the GitHub repository. Returns the file content.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path in the repo (e.g., dist/index.html)' },
            branch: { type: 'string', description: 'Branch to read from', default: 'staging' }
          },
          required: ['path']
        }
      },
      {
        name: 'write_file',
        description: 'Write/update a file in the GitHub repository on the staging branch.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path in the repo (e.g., dist/citizen-action/index.html)' },
            content: { type: 'string', description: 'The full new content of the file' },
            message: { type: 'string', description: 'Commit message describing the change' }
          },
          required: ['path', 'content', 'message']
        }
      },
      {
        name: 'update_page_content',
        description: 'Update the main content section of a page. Headers, footers, and navigation are preserved automatically from templates. This is the preferred method for editing pages.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Page path (e.g., dist/index.html)' },
            new_content: { type: 'string', description: 'New HTML content for the main section ONLY. Do not include headers, footers, or full page structure — just the main content area.' },
            message: { type: 'string', description: 'Commit message' }
          },
          required: ['path', 'new_content', 'message']
        }
      },
      {
        name: 'update_template',
        description: 'Edit a header, footer, or navigation template. Changes apply to ALL pages that use this template. Use with care — this affects the entire site.',
        input_schema: {
          type: 'object',
          properties: {
            template_type: { type: 'string', enum: ['header', 'footer', 'navigation'], description: 'Which template to edit' },
            new_content: { type: 'string', description: 'New HTML for the template' },
            message: { type: 'string', description: 'Commit message explaining the change' }
          },
          required: ['template_type', 'new_content', 'message']
        }
      },
      {
        name: 'read_file_section',
        description: 'Read a specific section of a file by searching for a text pattern. Returns 50 lines around the match. More token-efficient than read_file for large files.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path in the repo' },
            search: { type: 'string', description: 'Text to search for in the file' },
            context_lines: { type: 'number', description: 'Number of lines before and after match to include (default 25)' },
            branch: { type: 'string', description: 'Branch to read from', default: 'staging' }
          },
          required: ['path', 'search']
        }
      },
      {
        name: 'replace_page_content',
        description: 'Replace the main content of a page while preserving its header/head and footer. This is the most efficient way to edit large HTML pages. You provide ONLY the new main content HTML — the tool handles reading the existing header and footer and stitching them together.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path (e.g., dist/register-for-lobby-day-jan-27/index.html)' },
            new_content: { type: 'string', description: 'The new HTML for the main content area. Will be inserted between the header/nav and footer.' },
            content_start_marker: { type: 'string', description: 'Text that marks where the main content begins (e.g., "main-content" or a unique string near the start of the content area). Default: searches for <main or role="main" or first large content div after nav.' },
            content_end_marker: { type: 'string', description: 'Text that marks where the main content ends (e.g., "footer" or a unique string near the end). Default: searches for <footer or closing scripts section.' },
            message: { type: 'string', description: 'Commit message' }
          },
          required: ['path', 'new_content', 'message']
        }
      },
      {
        name: 'verify_links',
        description: 'Check if pages/paths exist in the site repo. Use before creating links to avoid 404s.',
        input_schema: {
          type: 'object',
          properties: {
            paths: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Array of URL paths to verify (e.g., ["/petition/", "/contact-us/"])' 
            }
          },
          required: ['paths']
        }
      },
      {
        name: 'revert_file',
        description: 'Revert a file to its version on the main (production) branch, undoing any staging changes.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path to revert (e.g., dist/citizen-action/index.html)' }
          },
          required: ['path']
        }
      },
      {
        name: 'list_files',
        description: 'List files in a directory of the GitHub repository.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path (e.g., dist/ or dist/css/)' },
            branch: { type: 'string', description: 'Branch to list from', default: 'staging' }
          },
          required: ['path']
        }
      },
      {
        name: 'capture_screenshot',
        description: 'Take a screenshot of a page on the staging site to see what it looks like. Use this to verify your changes or compare against a reference image.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'The page path to screenshot, e.g. "/" or "/about/"' }
          },
          required: ['path']
        }
      },
      {
        name: 'search_and_replace',
        description: 'Find and replace text in a file. Much more efficient than rewriting the entire file for small changes like updating text, changing colors, or swapping URLs.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path in the repo (e.g., dist/index.html)' },
            search: { type: 'string', description: 'Exact text to find in the file' },
            replace: { type: 'string', description: 'Replacement text' },
            message: { type: 'string', description: 'Commit message describing the change' },
            all: { type: 'boolean', description: 'Replace all occurrences (default: true)' }
          },
          required: ['path', 'search', 'replace', 'message']
        }
      },
      {
        name: 'get_page_styles',
        description: 'Extract CSS styles relevant to a page. Returns all CSS rules that could affect the page, helping you understand the current styling before making changes.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the HTML file (e.g., dist/index.html)' }
          },
          required: ['path']
        }
      },
      {
        name: 'create_page',
        description: 'Create a new page using an existing page as a template. Copies the head, navigation, and footer from the template page and inserts your new content in the main area.',
        input_schema: {
          type: 'object',
          properties: {
            template_path: { type: 'string', description: 'Existing page to use as template (e.g., dist/index.html)' },
            new_path: { type: 'string', description: 'Path for the new page (e.g., dist/about/index.html)' },
            title: { type: 'string', description: 'Page title' },
            content: { type: 'string', description: 'HTML for the main content area' },
            message: { type: 'string', description: 'Commit message' }
          },
          required: ['template_path', 'new_path', 'title', 'content', 'message']
        }
      },
      {
        name: 'validate_html',
        description: 'Check an HTML file for common issues like unclosed tags, missing quotes, or broken structure. Use this after making changes to catch problems before the user previews.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path in the repo (e.g., dist/index.html)' }
          },
          required: ['path']
        }
      },
      {
        name: 'diff_preview',
        description: 'Show what changed in a file compared to the production version. Helps users understand exactly what edits were made.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path in the repo (e.g., dist/index.html)' }
          },
          required: ['path']
        }
      },
      {
        name: 'get_site_colors',
        description: 'Extract the color palette used across the site\'s CSS files. Returns all colors (hex, rgb, hsl) found in stylesheets so you can match the site\'s branding.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Specific CSS file path (optional, defaults to all CSS in dist/css/)' }
          }
        }
      },
      {
        name: 'resize_image',
        description: 'Check an image and provide recommendations for web optimization. Reports file size and dimensions with advice on reducing load times.',
        input_schema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to image in the repo (e.g., dist/images/photo.jpg)' },
            max_width: { type: 'number', description: 'Target maximum width (default: 1200)' },
            quality: { type: 'number', description: 'Quality setting for JPEG (default: 85)' }
          },
          required: ['path']
        }
      },
      {
        name: 'list_content_templates',
        description: 'List all content templates available for this site. Content templates define how structured data (petitions, posts, events) renders on pages. Use this to see what templates exist before placing content.',
        input_schema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'get_content_template',
        description: 'Get the full HTML of a specific content template by name. Use this to see the template structure and available variables.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Template name (e.g., "petition_card", "post_full")' }
          },
          required: ['name']
        }
      },
      {
        name: 'create_content_template',
        description: 'Create a new content template. Use this when a user requests a content type that doesn\'t have a template yet. Always use brand variables ({{brand.colors.primary}}, {{brand.fonts.heading}}, etc.) for consistent styling.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Template identifier (e.g., "event_card", "volunteer_signup")' },
            description: { type: 'string', description: 'When to use this template (helps AI choose the right template)' },
            html: { type: 'string', description: 'Template HTML with {{variable}} placeholders and {{brand.colors.primary}} etc. for brand integration' },
            modes: { 
              type: 'array', 
              items: { type: 'string' },
              description: 'Array of contexts where this applies (e.g., ["card", "full", "banner"])' 
            }
          },
          required: ['name', 'description', 'html', 'modes']
        }
      },
      {
        name: 'update_content_template',
        description: 'Update an existing content template\'s HTML. Use this when users want to change the look/feel of a template.',
        input_schema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Template name to update' },
            html: { type: 'string', description: 'New template HTML' },
            description: { type: 'string', description: 'Updated description (optional)' }
          },
          required: ['name', 'html']
        }
      },
      {
        name: 'render_content',
        description: 'Render a content template with data. Takes a template name and data object, returns the rendered HTML with all variables filled in (including brand variables). This is what you use to generate actual page content.',
        input_schema: {
          type: 'object',
          properties: {
            template_name: { type: 'string', description: 'Name of the template to render' },
            data: { 
              type: 'object', 
              description: 'JSON object with variable values (e.g., {"title": "...", "description": "...", "url": "..."})'
            }
          },
          required: ['template_name', 'data']
        }
      }
    ];

    // Load custom tools from site config if defined
    if (site.config && site.config.custom_tools && Array.isArray(site.config.custom_tools)) {
      for (const customTool of site.config.custom_tools) {
        if (customTool.name && customTool.description && customTool.query) {
          const toolDef = {
            name: customTool.name,
            description: customTool.description,
            input_schema: {
              type: 'object',
              properties: {},
              required: customTool.params || []
            }
          };
          
          // Build parameter properties
          if (customTool.params && customTool.params.length > 0) {
            toolDef.input_schema.properties = Object.fromEntries(
              customTool.params.map(p => [p, { type: 'string', description: `Value for ${p}` }])
            );
          }
          
          tools.push(toolDef);
          console.log(`[Custom Tool] Registered: ${customTool.name}`);
        }
      }
    }

    // Tool execution function
    async function executeTool(toolName, toolInput) {
      const [owner, repoName] = site.github_repo.split('/');
      const token = site.github_token;

      if (toolName === 'read_file') {
        // IMPORTANT: Check pending_edits FIRST so AI can see its own recent changes
        try {
          const pendingResult = await pool.query(
            'SELECT content FROM pending_edits WHERE site_id = $1 AND file_path = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
            [req.params.siteId, toolInput.path, 'pending']
          );
          if (pendingResult.rows.length > 0) {
            console.log(`[read_file] Reading from pending_edits: ${toolInput.path}`);
            const content = pendingResult.rows[0].content;
            if (content.length > 15000) {
              const lines = content.split('\n');
              const summary = `[File is ${content.length} chars, ${lines.length} lines (from pending edits) — showing first 300 lines. Use read_file_section to find specific content.]\n\n`;
              return summary + lines.slice(0, 300).join('\n');
            }
            return content;
          }
        } catch (dbError) {
          // Table might not exist yet (migration pending) — fall back to GitHub
          console.log(`[read_file] pending_edits table not available, falling through: ${dbError.message}`);
        }

        // Check if page exists in database (template system)
        try {
          const page = await getPageByPath(pool, req.params.siteId, toolInput.path);
          if (page) {
            // Page is managed by template system — return just content section
            console.log(`[read_file] Reading from pages table: ${toolInput.path}`);
            return page.content;
          }
        } catch (dbError) {
          // Pages table might not exist yet (migration pending) — fall back to GitHub
          console.log(`[read_file] Pages table not available, using GitHub: ${dbError.message}`);
        }

        // Fall back to GitHub API if not in pages or pending_edits table
        const branch = toolInput.branch || 'staging';
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=${branch}`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (!resp.ok) {
          const err = await resp.json();
          return `Error reading file: ${err.message}`;
        }
        const data = await resp.json();
        if (!data.content) {
          return `Error: File content not available (file may be too large). Size: ${data.size || 'unknown'} bytes. Use read_file_section to read specific parts.`;
        }
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        // For large files, return structure overview + truncated content
        if (content.length > 15000) {
          const lines = content.split('\n');
          const summary = `[File is ${content.length} chars, ${lines.length} lines — showing first 300 lines. Use read_file_section with a search term to find specific content.]\n\n`;
          return summary + lines.slice(0, 300).join('\n');
        }
        return content;
      }

      if (toolName === 'read_file_section') {
        const branch = toolInput.branch || 'staging';
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=${branch}`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (!resp.ok) {
          const err = await resp.json();
          return `Error reading file: ${err.message}`;
        }
        const data = await resp.json();
        if (!data.content) return 'File content not available.';
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        const lines = content.split('\n');
        const contextLines = toolInput.context_lines || 25;
        
        // Find the search term
        const searchLower = toolInput.search.toLowerCase();
        const matchIndex = lines.findIndex(l => l.toLowerCase().includes(searchLower));
        
        if (matchIndex === -1) {
          return `Search term "${toolInput.search}" not found in ${toolInput.path}. File has ${lines.length} lines.`;
        }
        
        const start = Math.max(0, matchIndex - contextLines);
        const end = Math.min(lines.length, matchIndex + contextLines + 1);
        const section = lines.slice(start, end);
        
        return `[Lines ${start + 1}-${end} of ${lines.length} in ${toolInput.path}]\n\n${section.join('\n')}`;
      }

      if (toolName === 'write_file') {
        if (!toolInput.content) {
          return 'Error: No content provided for write_file.';
        }
        
        // Save to pending_edits table instead of committing directly to GitHub
        try {
          await pool.query(
            `INSERT INTO pending_edits (site_id, session_id, file_path, content, change_description, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT (site_id, file_path, status) 
             DO UPDATE SET content = $4, change_description = $5, created_at = NOW(), session_id = $2`,
            [req.params.siteId, session.id, toolInput.path, toolInput.content, toolInput.message || 'Update file via AI editor']
          );
          
          console.log(`[write_file] Saved to pending_edits: ${toolInput.path} (${toolInput.content.length} chars)`);
          return `File saved to preview. Click "Preview Edits" to see changes on staging.`;
        } catch (dbError) {
          // If pending_edits table doesn't exist yet, fall back to direct GitHub commit
          console.warn(`[write_file] pending_edits table not available, falling back to direct commit: ${dbError.message}`);
          
          // First check if file exists to get SHA
          let sha = null;
          const checkResp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          if (checkResp.ok) {
            const existing = await checkResp.json();
            sha = existing.sha;
          }

          const body = {
            message: toolInput.message || 'Update file via AI editor',
            content: Buffer.from(toolInput.content, 'utf-8').toString('base64'),
            branch: 'staging'
          };
          if (sha) body.sha = sha;

          const writeResp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}`,
            {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }
          );
          if (!writeResp.ok) {
            const err = await writeResp.json();
            return `Error writing file: ${err.message}`;
          }
          return `File ${toolInput.path} updated successfully on staging branch.`;
        }
      }

      if (toolName === 'update_page_content') {
        try {
          // Get page from database
          const page = await getPageByPath(pool, req.params.siteId, toolInput.path);
          if (!page) {
            return `Error: Page not found at ${toolInput.path}. This page may not have been indexed in the template system yet. Use write_file as a fallback or run the onboard endpoint to index the site.`;
          }

          // Update content in database
          const fullPage = await updatePageContent(pool, page.id, toolInput.new_content);

          // Save assembled page to pending_edits instead of GitHub
          try {
            await pool.query(
              `INSERT INTO pending_edits (site_id, session_id, file_path, content, change_description, status)
               VALUES ($1, $2, $3, $4, $5, 'pending')
               ON CONFLICT (site_id, file_path, status) 
               DO UPDATE SET content = $4, change_description = $5, created_at = NOW(), session_id = $2`,
              [req.params.siteId, session.id, toolInput.path, fullPage, toolInput.message || 'Update page content via AI editor']
            );
            
            console.log(`[update_page_content] Saved to pending_edits: ${toolInput.path}`);
            return `Page updated successfully. Header, footer, and navigation preserved automatically. Click "Preview Edits" to see changes on staging.`;
          } catch (dbError) {
            // If pending_edits table doesn't exist, fall back to direct GitHub commit
            console.warn(`[update_page_content] pending_edits not available, falling back to GitHub: ${dbError.message}`);
            
            // Get current file SHA from GitHub
            const ghResp = await fetch(
              `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
              { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
            );
            const ghSha = ghResp.ok ? (await ghResp.json()).sha : null;

            // Write assembled page to GitHub
            const writeBody = {
              message: toolInput.message || 'Update page content via AI editor',
              content: Buffer.from(fullPage, 'utf-8').toString('base64'),
              branch: 'staging'
            };
            if (ghSha) writeBody.sha = ghSha;

            const writeResp = await fetch(
              `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}`,
              {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
                body: JSON.stringify(writeBody)
              }
            );
            if (!writeResp.ok) {
              const err = await writeResp.json();
              return `Error writing to GitHub: ${err.message}`;
            }

            return `Page updated successfully. Header, footer, and navigation preserved automatically.`;
          }
        } catch (error) {
          console.error('[update_page_content] Error:', error);
          return `Error updating page: ${error.message}`;
        }
      }

      if (toolName === 'update_template') {
        try {
          // Get template from database
          const templateResult = await pool.query(
            'SELECT * FROM templates WHERE site_id = $1 AND type = $2',
            [req.params.siteId, toolInput.template_type]
          );
          
          if (templateResult.rows.length === 0) {
            return `Error: No ${toolInput.template_type} template found for this site. The template system may not be set up yet. Run the onboard endpoint first.`;
          }

          const template = templateResult.rows[0];

          // Update template in database
          await pool.query(
            'UPDATE templates SET content = $1, updated_at = NOW() WHERE id = $2',
            [toolInput.new_content, template.id]
          );

          // Regenerate all pages that use this template
          const regenerated = await regenerateAllPagesForTemplate(pool, template.id);

          console.log(`[update_template] Regenerating ${regenerated.length} pages`);

          // Save all regenerated pages to pending_edits instead of GitHub
          try {
            for (const { path, html } of regenerated) {
              await pool.query(
                `INSERT INTO pending_edits (site_id, session_id, file_path, content, change_description, status)
                 VALUES ($1, $2, $3, $4, $5, 'pending')
                 ON CONFLICT (site_id, file_path, status) 
                 DO UPDATE SET content = $4, change_description = $5, created_at = NOW(), session_id = $2`,
                [req.params.siteId, session.id, path, html, toolInput.message || `Update ${toolInput.template_type} template`]
              );
            }
            
            console.log(`[update_template] Saved ${regenerated.length} pages to pending_edits`);
            return `${toolInput.template_type} template updated successfully. ${regenerated.length} pages regenerated and saved to preview. Click "Preview Edits" to see changes on staging.`;
          } catch (dbError) {
            // If pending_edits table doesn't exist, fall back to direct GitHub commit
            console.warn(`[update_template] pending_edits not available, falling back to GitHub: ${dbError.message}`);
            
            // Batch commit all regenerated pages to GitHub
            for (const { path, html } of regenerated) {
              // Get current file SHA
              const ghResp = await fetch(
                `https://api.github.com/repos/${owner}/${repoName}/contents/${path}?ref=staging`,
                { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
              );
              const ghSha = ghResp.ok ? (await ghResp.json()).sha : null;

              // Write updated page
              await fetch(
                `https://api.github.com/repos/${owner}/${repoName}/contents/${path}`,
                {
                  method: 'PUT',
                  headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    message: toolInput.message || `Update ${toolInput.template_type} template`,
                    content: Buffer.from(html, 'utf-8').toString('base64'),
                    branch: 'staging',
                    sha: ghSha
                  })
                }
              );
            }

            return `${toolInput.template_type} template updated successfully. ${regenerated.length} pages regenerated and committed to staging. Changes will appear on all pages that use this template.`;
          }
        } catch (error) {
          console.error('[update_template] Error:', error);
          return `Error updating template: ${error.message}`;
        }
      }

      if (toolName === 'replace_page_content') {
        // Check for cached header/footer first
        const siteData = await pool.query('SELECT cached_header, cached_footer FROM sites WHERE id = $1', [req.params.siteId]);
        const cachedHeader = siteData.rows[0]?.cached_header;
        const cachedFooter = siteData.rows[0]?.cached_footer;
        
        let header, footer;
        
        if (cachedHeader && cachedFooter) {
          console.log(`[Tool] Using cached header (${cachedHeader.length} chars) and footer (${cachedFooter.length} chars)`);
          header = cachedHeader;
          footer = cachedFooter;
        } else {
          // No cache — read current file and parse
          const resp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          if (!resp.ok) {
            const err = await resp.json();
            return `Error reading file: ${err.message}`;
          }
          const data = await resp.json();
          if (!data.content) return 'File content not available.';
          const fullContent = Buffer.from(data.content, 'base64').toString('utf-8');
          
          const extracted = extractHeaderFooter(fullContent);
          header = extracted.header;
          footer = extracted.footer;
          
          await pool.query(
            'UPDATE sites SET cached_header = $1, cached_footer = $2 WHERE id = $3',
            [header, footer, req.params.siteId]
          );
          console.log(`[Tool] Auto-cached header/footer for ${req.params.siteId}`);
        }

        const newPage = header + '\n' + toolInput.new_content + '\n' + footer;

        // Save to pending_edits instead of GitHub
        try {
          await pool.query(
            `INSERT INTO pending_edits (site_id, session_id, file_path, content, change_description, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT (site_id, file_path, status) 
             DO UPDATE SET content = $4, change_description = $5, created_at = NOW(), session_id = $2`,
            [req.params.siteId, session.id, toolInput.path, newPage, toolInput.message || 'Update page content via AI editor']
          );
          console.log(`[replace_page_content] Saved to pending_edits: ${toolInput.path} (${newPage.length} chars)`);
          return `Page content replaced successfully. New content (${toolInput.new_content.length} chars) inserted with header and footer preserved. Click "Preview Edits" to see changes.`;
        } catch (dbError) {
          console.warn(`[replace_page_content] pending_edits not available, falling back to GitHub: ${dbError.message}`);
          const resp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          const sha = resp.ok ? (await resp.json()).sha : null;
          const writeBody = { message: toolInput.message || 'Update page content', content: Buffer.from(newPage, 'utf-8').toString('base64'), branch: 'staging' };
          if (sha) writeBody.sha = sha;
          await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}`,
            { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(writeBody) }
          );
          return `Page content replaced successfully.`;
        }
      }

      if (toolName === 'verify_links') {
        // Use cached valid_pages from brand guide if available (more efficient)
        const brandGuide = site.brand_guide || {};
        let existingPaths = [];
        
        if (brandGuide.valid_pages && brandGuide.valid_pages.length > 0) {
          existingPaths = brandGuide.valid_pages;
          console.log(`[verify_links] Using cached valid_pages from brand guide (${existingPaths.length} pages)`);
        } else {
          // Fallback to GitHub API if brand guide not populated
          console.log('[verify_links] Brand guide not available, fetching from GitHub API');
          const resp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/dist?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          if (!resp.ok) return 'Error checking links.';
          const items = await resp.json();
          existingPaths = items.filter(i => i.type === 'dir').map(i => '/' + i.name + '/');
          existingPaths.push('/'); // Homepage always exists
        }
        
        const results = toolInput.paths.map(path => {
          const normalized = path.endsWith('/') ? path : path + '/';
          const exists = existingPaths.some(p => p === normalized);
          return `${path}: ${exists ? 'EXISTS' : 'NOT FOUND'}`;
        });
        
        return results.join('\n') + '\n\nValid pages: ' + existingPaths.join(', ');
      }

      if (toolName === 'revert_file') {
        // Delete the pending edit for this file (if it exists)
        try {
          const deleteResult = await pool.query(
            'DELETE FROM pending_edits WHERE site_id = $1 AND file_path = $2 AND status = $3',
            [req.params.siteId, toolInput.path, 'pending']
          );
          
          if (deleteResult.rowCount > 0) {
            console.log(`[revert_file] Deleted pending edit for ${toolInput.path}`);
            return `File reverted to production version. Pending changes discarded.`;
          } else {
            return `No pending changes found for ${toolInput.path}. File is already at production version.`;
          }
        } catch (dbError) {
          // If pending_edits table doesn't exist, fall back to GitHub revert
          console.warn(`[revert_file] pending_edits not available, falling back to GitHub revert: ${dbError.message}`);
          
          // Read the file from main (production) branch
          const mainResp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=main`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          if (!mainResp.ok) {
            const err = await mainResp.json();
            return `Error reading production version: ${err.message}`;
          }
          const mainData = await mainResp.json();

          // Get current staging SHA for the file
          const stagingResp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          const stagingSha = stagingResp.ok ? (await stagingResp.json()).sha : null;

          // Write the main version back to staging
          const body = {
            message: `Revert: ${toolInput.path} to production version`,
            content: mainData.content.replace(/\n/g, ''), // GitHub returns base64 with newlines
            branch: 'staging'
          };
          if (stagingSha) body.sha = stagingSha;

          const writeResp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}`,
            {
              method: 'PUT',
              headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
              body: JSON.stringify(body)
            }
          );
          if (!writeResp.ok) {
            const err = await writeResp.json();
            return `Error reverting file: ${err.message}`;
          }
          return `File ${toolInput.path} reverted to production version on staging branch.`;
        }
      }

      if (toolName === 'list_files') {
        const branch = toolInput.branch || 'staging';
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=${branch}`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (!resp.ok) {
          const err = await resp.json();
          return `Error listing files: ${err.message}`;
        }
        const items = await resp.json();
        if (!Array.isArray(items)) return 'Path is a file, not a directory.';
        return items.map(i => `${i.type === 'dir' ? '📁' : '📄'} ${i.name} (${i.size || 'dir'})`).join('\n');
      }

      if (toolName === 'capture_screenshot') {
        // Get staging preview URL from site config or construct it
        const stagingSlug = site.config?.vercelSlug || 'rcl-integrated';
        const stagingDomain = site.vercel_project
          ? `${site.vercel_project}-git-staging-${stagingSlug}.vercel.app`
          : 'secure-the-vote-git-staging-rcl-integrated.vercel.app';
        const previewUrl = `https://${stagingDomain}${toolInput.path}`;

        console.log(`[Screenshot] Capturing: ${previewUrl}`);

        try {
          // Dynamic import for puppeteer (serverless-compatible)
          const puppeteer = await import('puppeteer-core');
          const chromium = await import('@sparticuz/chromium');

          const browser = await puppeteer.default.launch({
            args: await chromium.default.args,
            defaultViewport: chromium.default.defaultViewport,
            executablePath: await chromium.default.executablePath,
            headless: chromium.default.headless,
          });

          const page = await browser.newPage();
          await page.goto(previewUrl, { waitUntil: 'networkidle0', timeout: 30000 });
          const screenshotBuffer = await page.screenshot({ type: 'png' });
          await browser.close();

          // Return as structured content for Claude vision
          const base64 = screenshotBuffer.toString('base64');
          return { __image: true, base64, media_type: 'image/png' };
        } catch (screenshotError) {
          console.error('Screenshot error:', screenshotError.message);
          return `Error capturing screenshot: ${screenshotError.message}. Make sure the staging site is deployed and accessible.`;
        }
      }

      if (toolName === 'search_and_replace') {
        // Read file — check pending_edits first, then GitHub
        let content;
        try {
          const pendingResult = await pool.query(
            'SELECT content FROM pending_edits WHERE site_id = $1 AND file_path = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
            [req.params.siteId, toolInput.path, 'pending']
          );
          if (pendingResult.rows.length > 0) {
            content = pendingResult.rows[0].content;
            console.log(`[search_and_replace] Reading from pending_edits: ${toolInput.path}`);
          }
        } catch (dbError) {
          console.log(`[search_and_replace] pending_edits not available: ${dbError.message}`);
        }
        
        if (!content) {
          const resp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          if (!resp.ok) {
            const err = await resp.json();
            return `Error reading file: ${err.message}`;
          }
          const data = await resp.json();
          if (!data.content) return 'File content not available.';
          content = Buffer.from(data.content, 'base64').toString('utf-8');
        }
        
        const replaceAll = toolInput.all !== false;
        
        const occurrences = content.split(toolInput.search).length - 1;
        if (occurrences === 0) {
          return `Search text "${toolInput.search}" not found in ${toolInput.path}. Use read_file_section to find the exact text first.`;
        }
        
        if (replaceAll) {
          content = content.split(toolInput.search).join(toolInput.replace);
        } else {
          content = content.replace(toolInput.search, toolInput.replace);
        }
        
        // Save to pending_edits instead of GitHub
        try {
          await pool.query(
            `INSERT INTO pending_edits (site_id, session_id, file_path, content, change_description, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT (site_id, file_path, status) 
             DO UPDATE SET content = $4, change_description = $5, created_at = NOW(), session_id = $2`,
            [req.params.siteId, session.id, toolInput.path, content, toolInput.message || `Replace text in ${toolInput.path}`]
          );
          const replacedCount = replaceAll ? occurrences : 1;
          return `Successfully replaced ${replacedCount} occurrence${replacedCount !== 1 ? 's' : ''} of "${toolInput.search}" in ${toolInput.path}. Click "Preview Edits" to see changes.`;
        } catch (dbError) {
          console.warn(`[search_and_replace] pending_edits not available, falling back to GitHub: ${dbError.message}`);
          const resp2 = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          const data2 = resp2.ok ? await resp2.json() : {};
          const body = {
            message: toolInput.message || `Replace text in ${toolInput.path}`,
            content: Buffer.from(content, 'utf-8').toString('base64'),
            branch: 'staging',
            sha: data2.sha
          };
          await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}`,
            { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          );
          const replacedCount = replaceAll ? occurrences : 1;
          return `Successfully replaced ${replacedCount} occurrence${replacedCount !== 1 ? 's' : ''} of "${toolInput.search}" in ${toolInput.path}`;
        }
      }

      if (toolName === 'get_page_styles') {
        // Read the HTML file
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (!resp.ok) {
          const err = await resp.json();
          return `Error reading file: ${err.message}`;
        }
        const data = await resp.json();
        if (!data.content) return 'File content not available.';
        const htmlContent = Buffer.from(data.content, 'base64').toString('utf-8');
        
        // Extract linked stylesheets
        const styleSheetPattern = /<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"/gi;
        const styleMatches = [...htmlContent.matchAll(styleSheetPattern)];
        const stylesheets = styleMatches.map(m => m[1]);
        
        // Extract inline styles
        const styleTagPattern = /<style[^>]*>([\s\S]*?)<\/style>/gi;
        const styleTagMatches = [...htmlContent.matchAll(styleTagPattern)];
        const inlineStyles = styleTagMatches.map(m => m[1]);
        
        let allCss = '';
        
        // Fetch each linked stylesheet
        for (const href of stylesheets) {
          if (href.startsWith('http')) continue; // Skip external URLs
          const cleanPath = href.startsWith('/') ? href.slice(1) : href;
          try {
            const cssResp = await fetch(
              `https://api.github.com/repos/${owner}/${repoName}/contents/${cleanPath}?ref=staging`,
              { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
            );
            if (cssResp.ok) {
              const cssData = await cssResp.json();
              if (cssData.content) {
                allCss += `/* === ${cleanPath} ===\n */\n`;
                allCss += Buffer.from(cssData.content, 'base64').toString('utf-8');
                allCss += '\n\n';
              }
            }
          } catch (e) {
            console.warn(`Could not fetch stylesheet ${href}:`, e.message);
          }
        }
        
        // Add inline styles
        for (const inlineStyle of inlineStyles) {
          allCss += `/* === Inline <style> ===\n */\n`;
          allCss += inlineStyle + '\n\n';
        }
        
        // Truncate if too large
        if (allCss.length > 10000) {
          return allCss.slice(0, 10000) + `\n\n[CSS truncated — total size is ${allCss.length} characters. Showing first 10000 chars. Use get_site_colors to extract color palette or read specific CSS files directly.]`;
        }
        
        return allCss || 'No stylesheets or inline styles found on this page.';
      }

      if (toolName === 'create_page') {
        // Read template page
        const templateResp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.template_path}?ref=staging`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (!templateResp.ok) {
          const err = await templateResp.json();
          return `Error reading template: ${err.message}`;
        }
        const templateData = await templateResp.json();
        if (!templateData.content) return 'Template content not available.';
        const templateContent = Buffer.from(templateData.content, 'base64').toString('utf-8');
        
        const extracted = extractHeaderFooter(templateContent);
        let header = extracted.header;
        const footer = extracted.footer;
        
        header = header.replace(/<title>[^<]*<\/title>/i, `<title>${toolInput.title}</title>`);
        const newPage = header + '\n' + toolInput.content + '\n' + footer;
        
        // Save to pending_edits instead of GitHub
        try {
          await pool.query(
            `INSERT INTO pending_edits (site_id, session_id, file_path, content, change_description, status)
             VALUES ($1, $2, $3, $4, $5, 'pending')
             ON CONFLICT (site_id, file_path, status) 
             DO UPDATE SET content = $4, change_description = $5, created_at = NOW(), session_id = $2`,
            [req.params.siteId, session.id, toolInput.new_path, newPage, toolInput.message || `Create new page: ${toolInput.new_path}`]
          );
          return `New page created at ${toolInput.new_path} with title "${toolInput.title}". Click "Preview Edits" to see it.`;
        } catch (dbError) {
          console.warn(`[create_page] pending_edits not available, falling back to GitHub: ${dbError.message}`);
          const body = {
            message: toolInput.message || `Create new page: ${toolInput.new_path}`,
            content: Buffer.from(newPage, 'utf-8').toString('base64'),
            branch: 'staging'
          };
          await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.new_path}`,
            { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
          );
          return `New page created at ${toolInput.new_path} with title "${toolInput.title}".`;
        }
      }

      if (toolName === 'validate_html') {
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (!resp.ok) {
          const err = await resp.json();
          return `Error reading file: ${err.message}`;
        }
        const data = await resp.json();
        if (!data.content) return 'File content not available.';
        const content = Buffer.from(data.content, 'base64').toString('utf-8');
        
        const issues = [];
        
        // Check for DOCTYPE
        if (!/<\s*!DOCTYPE/i.test(content) && !/<html/i.test(content)) {
          issues.push('Missing DOCTYPE or <html> tag');
        }
        
        // Check for basic structure
        const hasHead = /<head/i.test(content);
        const hasBody = /<body/i.test(content);
        if (!hasHead && !hasBody) {
          issues.push('Missing <head> and <body> tags');
        }
        
        // Count opening vs closing tags for common elements
        const tags = ['div', 'section', 'main', 'header', 'footer', 'p', 'a', 'span', 'ul', 'li'];
        for (const tag of tags) {
          const openCount = (content.match(new RegExp(`<${tag}[\\s>]`, 'gi')) || []).length;
          const closeCount = (content.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
          if (openCount !== closeCount) {
            issues.push(`Tag mismatch: <${tag}> has ${openCount} opening tags but ${closeCount} closing tags`);
          }
        }
        
        // Check for unclosed quotes in attributes
        const attrPattern = /\s\w+="[^"]*$/gm;
        if (attrPattern.test(content)) {
          issues.push('Found potential unclosed quotes in attributes');
        }
        
        if (issues.length === 0) {
          return 'No issues found. HTML structure looks good!';
        }
        
        return 'Potential issues found:\n' + issues.map((i, idx) => `${idx + 1}. ${i}`).join('\n');
      }

      if (toolName === 'diff_preview') {
        // Try to read from pending_edits first
        let pendingContent = null;
        try {
          const pendingResult = await pool.query(
            'SELECT content FROM pending_edits WHERE site_id = $1 AND file_path = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1',
            [req.params.siteId, toolInput.path, 'pending']
          );
          if (pendingResult.rows.length > 0) {
            pendingContent = pendingResult.rows[0].content;
          }
        } catch (dbError) {
          console.log(`[diff_preview] pending_edits table not available: ${dbError.message}`);
        }
        
        // If no pending edit, read from staging
        if (!pendingContent) {
          const stagingResp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          if (!stagingResp.ok) {
            const err = await stagingResp.json();
            return `Error reading staging version: ${err.message}`;
          }
          const stagingData = await stagingResp.json();
          if (!stagingData.content) return 'Staging content not available.';
          pendingContent = Buffer.from(stagingData.content, 'base64').toString('utf-8');
        }
        
        // Read from main
        const mainResp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=main`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (!mainResp.ok) {
          return `File does not exist in production (main branch). This is a new file.`;
        }
        const mainData = await mainResp.json();
        if (!mainData.content) return 'Main content not available.';
        const mainContent = Buffer.from(mainData.content, 'base64').toString('utf-8');
        
        // Simple line-by-line diff
        const pendingLines = pendingContent.split('\n');
        const mainLines = mainContent.split('\n');
        
        const diff = [];
        const maxLen = Math.max(pendingLines.length, mainLines.length);
        let changeCount = 0;
        const maxChanges = 50;
        
        for (let i = 0; i < maxLen && changeCount < maxChanges; i++) {
          const pendingLine = pendingLines[i] || '';
          const mainLine = mainLines[i] || '';
          
          if (pendingLine !== mainLine) {
            changeCount++;
            if (mainLine) diff.push(`- ${mainLine}`);
            if (pendingLine) diff.push(`+ ${pendingLine}`);
            diff.push('');
          }
        }
        
        if (changeCount === 0) {
          return 'No differences found between pending changes and production.';
        }
        
        const summary = `${changeCount} changes${changeCount >= maxChanges ? ' (showing first 50)' : ''}:\n\n`;
        return summary + diff.slice(0, 150).join('\n');
      }

      if (toolName === 'get_site_colors') {
        let cssFiles = [];
        let allCss = '';
        
        if (toolInput.path) {
          // Read specific CSS file
          const resp = await fetch(
            `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
            { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
          );
          if (!resp.ok) {
            const err = await resp.json();
            return `Error reading file: ${err.message}`;
          }
          const data = await resp.json();
          if (!data.content) return 'File content not available.';
          allCss = Buffer.from(data.content, 'base64').toString('utf-8');
        } else {
          // List all CSS files in dist/css/
          try {
            const listResp = await fetch(
              `https://api.github.com/repos/${owner}/${repoName}/contents/dist/css?ref=staging`,
              { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
            );
            if (listResp.ok) {
              const items = await listResp.json();
              for (const item of items) {
                if (item.name.endsWith('.css')) {
                  try {
                    const cssResp = await fetch(
                      `https://api.github.com/repos/${owner}/${repoName}/contents/dist/css/${item.name}?ref=staging`,
                      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
                    );
                    if (cssResp.ok) {
                      const cssData = await cssResp.json();
                      if (cssData.content) {
                        allCss += Buffer.from(cssData.content, 'base64').toString('utf-8') + '\n';
                      }
                    }
                  } catch (e) {
                    console.warn(`Error reading CSS file ${item.name}:`, e.message);
                  }
                }
              }
            }
          } catch (e) {
            console.warn('Error listing CSS files:', e.message);
            return 'Could not list CSS files. Try specifying a path parameter.';
          }
        }
        
        // Extract colors using regex
        const hexPattern = /#[0-9A-Fa-f]{3,8}/g;
        const rgbPattern = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g;
        const hslPattern = /hsla?\s*\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%/g;
        const cssVarPattern = /--([\w-]+)\s*:\s*([^;]+);/g;
        
        const colors = {
          hex: new Set(),
          rgb: new Set(),
          hsl: new Set(),
          cssVars: new Set()
        };
        
        // Extract hex colors
        let match;
        while ((match = hexPattern.exec(allCss))) {
          colors.hex.add(match[0]);
        }
        
        // Extract rgb colors
        while ((match = rgbPattern.exec(allCss))) {
          colors.rgb.add(`rgb(${match[1]}, ${match[2]}, ${match[3]})`);
        }
        
        // Extract hsl colors
        while ((match = hslPattern.exec(allCss))) {
          colors.hsl.add(`hsl(${match[1]}, ${match[2]}%, ${match[3]}%)`);
        }
        
        // Extract CSS custom properties that contain colors
        while ((match = cssVarPattern.exec(allCss))) {
          const varName = match[1];
          const varValue = match[2].trim();
          if (/#[0-9A-Fa-f]{3,8}/.test(varValue) || /rgb/.test(varValue) || /hsl/.test(varValue)) {
            colors.cssVars.add(`--${varName}: ${varValue}`);
          }
        }
        
        let result = '**Color Palette Extracted:**\n\n';
        if (colors.hex.size > 0) result += `**Hex Colors (${colors.hex.size}):**\n${Array.from(colors.hex).join(', ')}\n\n`;
        if (colors.rgb.size > 0) result += `**RGB Colors (${colors.rgb.size}):**\n${Array.from(colors.rgb).join(', ')}\n\n`;
        if (colors.hsl.size > 0) result += `**HSL Colors (${colors.hsl.size}):**\n${Array.from(colors.hsl).join(', ')}\n\n`;
        if (colors.cssVars.size > 0) result += `**CSS Variables (${colors.cssVars.size}):**\n${Array.from(colors.cssVars).join('\n')}\n`;
        
        if (colors.hex.size === 0 && colors.rgb.size === 0 && colors.hsl.size === 0 && colors.cssVars.size === 0) {
          return 'No colors found in CSS files.';
        }
        
        return result;
      }

      if (toolName === 'resize_image') {
        // Read image metadata from GitHub
        const resp = await fetch(
          `https://api.github.com/repos/${owner}/${repoName}/contents/${toolInput.path}?ref=staging`,
          { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
        );
        if (!resp.ok) {
          const err = await resp.json();
          return `Error reading file: ${err.message}`;
        }
        const data = await resp.json();
        const fileSizeKB = (data.size / 1024).toFixed(1);
        
        // Provide feedback
        let result = `**Image Info:** ${toolInput.path}\n`;
        result += `**File Size:** ${fileSizeKB} KB\n\n`;
        
        if (data.size < 500 * 1024) {
          result += 'This image is already web-optimized (under 500 KB). No resizing needed.';
        } else {
          result += `This image is ${fileSizeKB} KB and could be optimized for web.\n`;
          result += `**Recommendation:** Upload a pre-sized version at max-width: ${toolInput.max_width || 1200}px with quality ${toolInput.quality || 85} for JPEG.\n`;
          result += 'For best results, use an online image optimizer like TinyPNG or ImageOptim before uploading.';
        }
        
        return result;
      }

      // Content Template Tools
      if (toolName === 'list_content_templates') {
        const config = site.config || {};
        const templates = config.content_templates || [];
        
        if (templates.length === 0) {
          return 'No content templates configured for this site yet. Use create_content_template to add templates for structured content like petitions, posts, or events.';
        }
        
        const templateList = templates.map(t => {
          return `**${t.name}**\n  Description: ${t.description}\n  Modes: ${t.modes.join(', ')}`;
        }).join('\n\n');
        
        return `Available content templates (${templates.length}):\n\n${templateList}`;
      }

      if (toolName === 'get_content_template') {
        const config = site.config || {};
        const templates = config.content_templates || [];
        const template = templates.find(t => t.name === toolInput.name);
        
        if (!template) {
          return `Template "${toolInput.name}" not found. Use list_content_templates to see available templates.`;
        }
        
        return `**Template: ${template.name}**\n\nDescription: ${template.description}\nModes: ${template.modes.join(', ')}\n\n**HTML:**\n\`\`\`html\n${template.html}\n\`\`\``;
      }

      if (toolName === 'create_content_template') {
        // Get current config
        const config = site.config || {};
        const templates = config.content_templates || [];
        
        // Check if template with this name already exists
        if (templates.find(t => t.name === toolInput.name)) {
          return `Error: Template "${toolInput.name}" already exists. Use update_content_template to modify it.`;
        }
        
        // Add new template
        const newTemplate = {
          name: toolInput.name,
          description: toolInput.description,
          html: toolInput.html,
          modes: toolInput.modes
        };
        templates.push(newTemplate);
        
        // Update config in database
        config.content_templates = templates;
        await pool.query(
          'UPDATE sites SET config = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(config), req.params.siteId]
        );
        
        console.log(`[create_content_template] Created template: ${toolInput.name}`);
        return `Content template "${toolInput.name}" created successfully. Use render_content to generate HTML from this template.`;
      }

      if (toolName === 'update_content_template') {
        // Get current config
        const config = site.config || {};
        const templates = config.content_templates || [];
        
        // Find template to update
        const templateIndex = templates.findIndex(t => t.name === toolInput.name);
        if (templateIndex === -1) {
          return `Error: Template "${toolInput.name}" not found. Use create_content_template to create it first.`;
        }
        
        // Update template
        templates[templateIndex].html = toolInput.html;
        if (toolInput.description) {
          templates[templateIndex].description = toolInput.description;
        }
        
        // Update config in database
        config.content_templates = templates;
        await pool.query(
          'UPDATE sites SET config = $1, updated_at = NOW() WHERE id = $2',
          [JSON.stringify(config), req.params.siteId]
        );
        
        console.log(`[update_content_template] Updated template: ${toolInput.name}`);
        return `Content template "${toolInput.name}" updated successfully.`;
      }

      if (toolName === 'render_content') {
        // Get template from config
        const config = site.config || {};
        const templates = config.content_templates || [];
        const template = templates.find(t => t.name === toolInput.template_name);
        
        if (!template) {
          return `Error: Template "${toolInput.template_name}" not found. Use list_content_templates to see available templates.`;
        }
        
        // Render template with data and brand guide
        const rendered = renderTemplate(template.html, toolInput.data, site.brand_guide);
        
        console.log(`[render_content] Rendered template: ${toolInput.template_name} (${rendered.length} chars)`);
        return rendered;
      }

      // Check if this is a custom tool
      if (site.config && site.config.custom_tools && Array.isArray(site.config.custom_tools)) {
        const customTool = site.config.custom_tools.find(t => t.name === toolName);
        if (customTool) {
          try {
            // Validate query is SELECT-only (security check)
            const queryTrimmed = customTool.query.trim().toUpperCase();
            if (!queryTrimmed.startsWith('SELECT')) {
              return `Error: Custom tool queries must be SELECT statements only. Query starts with: ${customTool.query.trim().split(' ')[0]}`;
            }
            
            // Check for dangerous SQL keywords
            const dangerousKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'TRUNCATE', 'EXEC'];
            for (const keyword of dangerousKeywords) {
              if (queryTrimmed.includes(keyword)) {
                return `Error: Custom tool queries cannot contain ${keyword} statements.`;
              }
            }
            
            // Connect to custom DB if specified, otherwise use main site DB
            const dbUrl = site.config.custom_db_url || process.env.DATABASE_URL;
            const customPool = new pg.Pool({ connectionString: dbUrl });
            
            try {
              // Build parameters array from toolInput
              const params = (customTool.params || []).map(paramName => toolInput[paramName]);
              
              console.log(`[Custom Tool] Executing ${toolName}: ${customTool.query.slice(0, 100)}... with params:`, params);
              
              // Execute query
              const result = await customPool.query(customTool.query, params);
              
              // Return results as JSON
              return JSON.stringify({
                rows: result.rows,
                rowCount: result.rowCount
              }, null, 2);
            } finally {
              await customPool.end();
            }
          } catch (error) {
            console.error(`[Custom Tool] Error executing ${toolName}:`, error);
            return `Error executing custom tool: ${error.message}`;
          }
        }
      }

      return `Unknown tool: ${toolName}`;
    }

    // Check if client wants streaming (SSE)
    const wantsStream = req.query.stream === 'true' || req.headers.accept === 'text/event-stream';

    // Helper to send SSE status updates
    let sendStatus;
    if (wantsStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      sendStatus = (status) => {
        res.write(`data: ${JSON.stringify({ type: 'status', status })}\n\n`);
      };
    } else {
      sendStatus = () => {}; // no-op for non-streaming
    }

    // Friendly tool names for status updates
    const toolStatusMap = {
      list_files: (input) => `Browsing ${input.path || 'files'}...`,
      read_file: (input) => `Reading ${input.path?.split('/').pop() || 'file'}...`,
      read_file_section: (input) => `Searching for "${input.search?.slice(0, 30)}" in ${input.path?.split('/').pop() || 'file'}...`,
      write_file: (input) => `Saving changes to ${input.path?.split('/').pop() || 'file'}...`,
      replace_page_content: (input) => `Updating page content in ${input.path?.split('/').pop() || 'page'}...`,
      verify_links: () => `Checking links...`,
      revert_file: (input) => `Reverting ${input.path?.split('/').pop() || 'file'}...`,
      capture_screenshot: (input) => `Taking a screenshot of ${input.path || '/'}...`,
      search_and_replace: (input) => `Finding and replacing "${input.search?.slice(0, 30)}" in ${input.path?.split('/').pop() || 'file'}...`,
      get_page_styles: (input) => `Extracting CSS styles from ${input.path?.split('/').pop() || 'page'}...`,
      create_page: (input) => `Creating new page from template...`,
      validate_html: (input) => `Validating HTML structure in ${input.path?.split('/').pop() || 'file'}...`,
      diff_preview: (input) => `Comparing ${input.path?.split('/').pop() || 'file'} against production...`,
      get_site_colors: (input) => `Extracting color palette${input.path ? ' from ' + input.path.split('/').pop() : ''}...`,
      resize_image: (input) => `Checking image optimization for ${input.path?.split('/').pop() || 'image'}...`,
    };

    // Call Claude with tools — loop until we get a final text response
    let currentMessages = messages;
    let assistantMessage = '';
    let loopCount = 0;
    const MAX_LOOPS = 25;

    console.log(`[Chat] Site: ${siteId} | Message: "${message.slice(0, 80)}..." | History: ${history.length} msgs`);
    sendStatus('Thinking...');

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 16384,
        system: [{ type: 'text', text: await buildSystemPrompt(site, pool, tools), cache_control: { type: 'ephemeral' } }],
        tools,
        messages: currentMessages
      });

      // Process response content
      const toolResults = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          assistantMessage += block.text;
          // Stream intermediate text as a progress message
          if (wantsStream && block.text.trim()) {
            res.write(`data: ${JSON.stringify({ type: 'progress', text: block.text.trim() })}\n\n`);
          }
        } else if (block.type === 'tool_use') {
          const friendlyStatus = toolStatusMap[block.name]?.(block.input) || `Running ${block.name}...`;
          sendStatus(friendlyStatus);
          console.log(`[Tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 300)}`);
          try {
            const result = await executeTool(block.name, block.input);
            // Handle image results (screenshots) — return as image content block for Claude vision
            if (result && result.__image) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: [
                  { type: 'text', text: 'Screenshot captured successfully. Here is what the page looks like:' },
                  { type: 'image', source: { type: 'base64', media_type: result.media_type, data: result.base64 } }
                ]
              });
            } else {
              toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result || 'Tool completed with no output.') });
            }
          } catch (toolErr) {
            console.error(`Tool error (${block.name}):`, toolErr.message);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Tool error: ${toolErr.message}`, is_error: true });
          }
        }
      }

      // If Claude wants to use tools, feed results back
      if (response.stop_reason === 'tool_use' && toolResults.length > 0) {
        currentMessages = [
          ...currentMessages,
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResults }
        ];
        continue;
      }

      // Done — Claude gave us a final text response
      break;
    }
    
    console.log(`[Chat] Complete: ${loopCount} turns, response: ${assistantMessage.length} chars`);
    
    // Save assistant message
    await saveMessage(session.id, 'assistant', assistantMessage);
    
    // Update session timestamp
    await pool.query('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [session.id]);
    
    if (wantsStream) {
      res.write(`data: ${JSON.stringify({ type: 'done', message: assistantMessage, sessionId: session.id })}\n\n`);
      res.end();
    } else {
      res.json({
        message: assistantMessage,
        sessionId: session.id
      });
    }
    
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /sites/:siteId/history
app.get('/sites/:siteId/history', async (req, res) => {
  try {
    const { siteId } = req.params;
    
    // Check if site exists
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    // Get or create session
    const session = await getSession(siteId);
    
    // Get chat history (may be empty for new sessions)
    const history = await getChatHistory(session.id, 50);
    
    res.json({
      sessionId: session.id,
      messages: history || []
    });
  } catch (error) {
    console.error('History error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /sites/:siteId/pending-edits - List all pending edits
app.get('/sites/:siteId/pending-edits', async (req, res) => {
  try {
    const { siteId } = req.params;
    
    // Check if site exists
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    
    // Get all pending edits for this site
    try {
      const result = await pool.query(
        'SELECT id, file_path, change_description, created_at FROM pending_edits WHERE site_id = $1 AND status = $2 ORDER BY created_at DESC',
        [siteId, 'pending']
      );
      
      res.json({
        pending: result.rows,
        count: result.rows.length
      });
    } catch (dbError) {
      // Table doesn't exist yet
      console.log(`[pending-edits] Table not available: ${dbError.message}`);
      res.json({ pending: [], count: 0 });
    }
  } catch (error) {
    console.error('Pending edits error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sites/:siteId/sync-staging - Reset staging branch to match main (production)
app.post('/sites/:siteId/sync-staging', async (req, res) => {
  try {
    const { siteId } = req.params;
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) return res.status(404).json({ error: 'Site not found' });
    const site = siteResult.rows[0];
    const [owner, repoName] = site.github_repo.split('/');
    const token = site.github_token;

    // Get main branch SHA
    const mainRef = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/main`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (!mainRef.ok) return res.status(500).json({ error: 'Failed to get main branch ref' });
    const mainData = await mainRef.json();
    const mainSha = mainData.object.sha;

    // Force-update staging to point to same commit as main
    const updateRef = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/staging`,
      {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha: mainSha, force: true })
      }
    );
    if (!updateRef.ok) {
      const err = await updateRef.json();
      return res.status(500).json({ error: `Failed to sync staging: ${err.message}` });
    }

    // Discard any existing pending edits (they were from a stale session)
    try {
      await pool.query(
        "UPDATE pending_edits SET status = 'discarded' WHERE site_id = $1 AND status = 'pending'",
        [siteId]
      );
    } catch (e) { /* table may not exist */ }

    // Clear old chat session so AI starts fresh (no stale context)
    try {
      const oldSession = await pool.query(
        'SELECT id FROM sessions WHERE site_id = $1 ORDER BY updated_at DESC LIMIT 1',
        [siteId]
      );
      if (oldSession.rows.length > 0) {
        const oldId = oldSession.rows[0].id;
        await pool.query('DELETE FROM messages WHERE session_id = $1', [oldId]);
        await pool.query('DELETE FROM sessions WHERE id = $1', [oldId]);
        console.log(`[sync-staging] Cleared old session ${oldId}`);
      }
    } catch (e) {
      console.log(`[sync-staging] Session cleanup skipped: ${e.message}`);
    }

    console.log(`[sync-staging] Staging synced to main (${mainSha.slice(0, 7)}) for ${siteId}`);
    res.json({ synced: true, sha: mainSha, message: 'Staging branch synced to production' });
  } catch (error) {
    console.error('Sync staging error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sites/:siteId/push-to-staging - Batch commit all pending edits to GitHub staging branch
app.post('/sites/:siteId/push-to-staging', async (req, res) => {
  try {
    const { siteId } = req.params;
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    // Get all pending edits for this site
    let pendingEdits = [];
    try {
      const result = await pool.query(
        'SELECT * FROM pending_edits WHERE site_id = $1 AND status = $2 ORDER BY created_at ASC',
        [siteId, 'pending']
      );
      pendingEdits = result.rows;
    } catch (dbError) {
      // Table doesn't exist yet — nothing to push
      console.log(`[push-to-staging] pending_edits table not available: ${dbError.message}`);
      return res.json({ pushed: 0, message: 'No pending edits to push' });
    }
    
    if (pendingEdits.length === 0) {
      return res.json({ pushed: 0, message: 'No pending edits to push' });
    }
    
    console.log(`[push-to-staging] Pushing ${pendingEdits.length} pending edits to GitHub staging`);
    
    // Batch commit all pending edits using GitHub Trees API
    const [owner, repoName] = site.github_repo.split('/');
    const token = site.github_token;
    
    // 1. Get current staging branch ref
    const refResp = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/staging`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (!refResp.ok) {
      const refErr = await refResp.json();
      return res.status(500).json({ error: `Failed to get staging ref: ${refErr.message}` });
    }
    const refData = await refResp.json();
    const currentStagingSha = refData.object.sha;
    
    // 2. Get current commit to get tree SHA
    const commitResp = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/commits/${currentStagingSha}`,
      { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }
    );
    if (!commitResp.ok) {
      const commitErr = await commitResp.json();
      return res.status(500).json({ error: `Failed to get commit: ${commitErr.message}` });
    }
    const commitData = await commitResp.json();
    const baseTreeSha = commitData.tree.sha;
    
    // 3. Create new tree with all pending files
    const tree = pendingEdits.map(edit => ({
      path: edit.file_path,
      mode: '100644',
      type: 'blob',
      content: edit.content
    }));
    
    const treeResp = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/trees`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree
        })
      }
    );
    if (!treeResp.ok) {
      const treeErr = await treeResp.json();
      return res.status(500).json({ error: `Failed to create tree: ${treeErr.message}` });
    }
    const treeData = await treeResp.json();
    const newTreeSha = treeData.sha;
    
    // 4. Create new commit
    const commitMessage = `AI edits: ${pendingEdits.length} file${pendingEdits.length !== 1 ? 's' : ''} updated\n\n${pendingEdits.map(e => `- ${e.file_path}: ${e.change_description || 'Updated'}`).slice(0, 10).join('\n')}${pendingEdits.length > 10 ? `\n... and ${pendingEdits.length - 10} more` : ''}`;
    
    const newCommitResp = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/commits`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: commitMessage,
          tree: newTreeSha,
          parents: [currentStagingSha]
        })
      }
    );
    if (!newCommitResp.ok) {
      const newCommitErr = await newCommitResp.json();
      return res.status(500).json({ error: `Failed to create commit: ${newCommitErr.message}` });
    }
    const newCommitData = await newCommitResp.json();
    const newCommitSha = newCommitData.sha;
    
    // 5. Update staging ref to point to new commit
    const updateRefResp = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/git/refs/heads/staging`,
      {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sha: newCommitSha,
          force: false
        })
      }
    );
    if (!updateRefResp.ok) {
      const updateRefErr = await updateRefResp.json();
      return res.status(500).json({ error: `Failed to update ref: ${updateRefErr.message}` });
    }
    
    // 6. Delete old pushed records for the same files, then mark pending as pushed
    const pendingFilePaths = pendingEdits.map(e => e.file_path);
    await pool.query(
      'DELETE FROM pending_edits WHERE site_id = $1 AND status = $2 AND file_path = ANY($3)',
      [siteId, 'pushed', pendingFilePaths]
    );
    await pool.query(
      'UPDATE pending_edits SET status = $1, updated_at = NOW() WHERE site_id = $2 AND status = $3',
      ['pushed', siteId, 'pending']
    );
    
    console.log(`[push-to-staging] Successfully pushed ${pendingEdits.length} edits to staging (commit ${newCommitSha.slice(0, 7)})`);
    
    // Trigger Vercel deployment via deploy hook (webhook is broken)
    const deployHookUrl = site.config?.stagingDeployHook;
    if (deployHookUrl) {
      try {
        const hookResp = await fetch(deployHookUrl, { method: 'POST' });
        const hookData = await hookResp.json();
        console.log(`[push-to-staging] Triggered Vercel deploy hook: ${hookData?.job?.id || 'ok'}`);
      } catch (hookErr) {
        console.error(`[push-to-staging] Deploy hook failed (non-fatal): ${hookErr.message}`);
      }
    } else if (site.vercel_token && site.vercel_project_id) {
      // Fallback: trigger deploy via Vercel API
      try {
        const deployResp = await fetch(`https://api.vercel.com/v13/deployments`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${site.vercel_token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            name: site.vercel_project,
            project: site.vercel_project_id,
            target: 'preview',
            gitSource: {
              type: 'github',
              repo: site.github_repo.split('/')[1],
              org: site.github_repo.split('/')[0],
              ref: 'staging'
            }
          })
        });
        if (deployResp.ok) {
          const deployData = await deployResp.json();
          console.log(`[push-to-staging] Triggered Vercel deployment: ${deployData.id}`);
        } else {
          const deployErr = await deployResp.text();
          console.error(`[push-to-staging] Vercel deploy API failed: ${deployErr}`);
        }
      } catch (vercelErr) {
        console.error(`[push-to-staging] Vercel deploy failed (non-fatal): ${vercelErr.message}`);
      }
    }
    
    // Generate preview URL
    const vercelSlug = site.config?.vercelSlug || 'rcl-integrated';
    const previewUrl = `https://${site.vercel_project}-git-staging-${vercelSlug}.vercel.app`;
    
    res.json({
      pushed: pendingEdits.length,
      commitSha: newCommitSha,
      previewUrl,
      message: `${pendingEdits.length} file${pendingEdits.length !== 1 ? 's' : ''} pushed to staging`
    });
  } catch (error) {
    console.error('Push to staging error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sites/:siteId/preview
app.post('/sites/:siteId/preview', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { files = [] } = req.body; // Optional: specific files to include in preview
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    // IMPORTANT: Push all pending edits to staging BEFORE starting Vercel polling
    // This ensures the preview shows the latest AI changes
    try {
      const pendingResult = await pool.query(
        'SELECT COUNT(*) as count FROM pending_edits WHERE site_id = $1 AND status = $2',
        [siteId, 'pending']
      );
      const pendingCount = parseInt(pendingResult.rows[0]?.count || 0);
      
      if (pendingCount > 0) {
        console.log(`[preview] Pushing ${pendingCount} pending edits before starting preview...`);
        
        // Call internal push-to-staging logic (or make internal request)
        const pushResp = await fetch(`http://localhost:${PORT}/sites/${siteId}/push-to-staging`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        
        if (!pushResp.ok) {
          const pushErr = await pushResp.json();
          console.error('[preview] Failed to push pending edits:', pushErr.error);
          // Continue anyway — maybe there are already changes on staging
        } else {
          const pushData = await pushResp.json();
          console.log(`[preview] Pushed ${pushData.pushed} edits to staging`);
        }
      } else {
        console.log('[preview] No pending edits to push');
      }
    } catch (dbError) {
      console.log(`[preview] Could not check pending edits: ${dbError.message}`);
      // Continue anyway — table might not exist yet
    }
    
    const session = await getSession(siteId);
    
    // Get actual staging deployment URL from Vercel
    let previewUrl;
    let deploymentFound = false;
    
    if (site.vercel_token && site.vercel_project_id) {
      try {
        console.log(`Querying Vercel API: projectId=${site.vercel_project_id}, token=${site.vercel_token.substring(0, 10)}...`);
        const deploymentsRes = await fetch(`https://api.vercel.com/v6/deployments?projectId=${site.vercel_project_id}&limit=20`, {
          headers: {
            'Authorization': `Bearer ${site.vercel_token}`
          }
        });
        console.log(`Vercel API response: ${deploymentsRes.status}`);
        
        if (deploymentsRes.ok) {
          const deploymentsData = await deploymentsRes.json();
          // Find latest READY deployment for staging branch
          const stagingDeployment = deploymentsData.deployments.find(d => 
            d.meta?.githubCommitRef === 'staging' && 
            (d.state === 'READY' || d.readyState === 'READY')
          );
          
          if (stagingDeployment) {
            previewUrl = `https://${stagingDeployment.url}`;
            deploymentFound = true;
          }
        }
      } catch (vercelError) {
        console.warn('Could not fetch Vercel deployments:', vercelError.message);
      }
    }
    
    // Fallback to pattern-based URL if API call fails or no deployment found
    if (!previewUrl) {
      // Vercel uses team/account slug, not GitHub username
      // For personal accounts: {project}-git-staging-{vercel-username}.vercel.app
      // Store the correct slug in site config, or use a known default
      const vercelSlug = site.config?.vercelSlug || 'rcl-integrated';
      previewUrl = `https://${site.vercel_project}-git-staging-${vercelSlug}.vercel.app`;
    }
    
    if (!previewUrl || !previewUrl.startsWith('http')) {
      throw new Error('Could not generate valid preview URL');
    }
    
    console.log(`Staging preview URL: ${previewUrl} (${deploymentFound ? 'from Vercel API' : 'pattern-based'})`);
    
    // Save edit record
    await pool.query(
      'INSERT INTO edits (session_id, file_path, change_description, preview_url, preview_branch) VALUES ($1, $2, $3, $4, $5)',
      [session.id, files.join(', ') || 'AI changes', 'Staging preview', previewUrl, 'staging']
    );
    
    res.json({
      previewUrl,
      branch: 'staging',
      message: 'Staging preview ready. Opens in new tab.'
    });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sites/:siteId/publish (formerly /approve)
app.post('/sites/:siteId/publish', async (req, res) => {
  try {
    const { siteId } = req.params;
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    console.log(`Publishing staging to production (main)`);
    
    // Merge staging to main
    await publishToProduction(
      site.github_repo, 
      site.github_token,
      'Publish changes from staging to production'
    );
    
    // Mark recent staging edits as published
    await pool.query(
      `UPDATE edits 
       SET approved = true, deployed_at = NOW() 
       WHERE session_id IN (SELECT id FROM sessions WHERE site_id = $1)
       AND preview_branch = 'staging'
       AND approved = false`,
      [siteId]
    );
    
    console.log(`Staging merged to main. Production deployment starting...`);
    
    // Trigger Vercel production deploy (webhook is broken)
    const prodDeployHook = site.config?.prodDeployHook;
    if (prodDeployHook) {
      try {
        await fetch(prodDeployHook, { method: 'POST' });
        console.log('[publish] Triggered production deploy hook');
      } catch (e) { console.error('[publish] Deploy hook failed:', e.message); }
    } else if (site.vercel_token && site.vercel_project_id) {
      try {
        await fetch(`https://api.vercel.com/v13/deployments`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${site.vercel_token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: site.vercel_project,
            project: site.vercel_project_id,
            target: 'production',
            gitSource: { type: 'github', repo: site.github_repo.split('/')[1], org: site.github_repo.split('/')[0], ref: 'main' }
          })
        });
        console.log('[publish] Triggered Vercel production deployment');
      } catch (e) { console.error('[publish] Vercel deploy failed:', e.message); }
    }
    
    res.json({ 
      status: 'published', 
      message: 'Changes published to production. Live site will update in ~30 seconds.',
      productionUrl: `https://${site.domain}`
    });
  } catch (error) {
    console.error('Publish error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Legacy /approve endpoint (redirect to /publish)
app.post('/sites/:siteId/approve', async (req, res) => {
  return app.handle(
    { ...req, url: `/sites/${req.params.siteId}/publish` },
    res
  );
});

// ============================================================
// Storage Abstraction Layer (Swappable for Google Drive)
// ============================================================

// (Storage functions defined at top of file)

// Multer configuration for file uploads (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB max
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Allowed: jpg, png, gif, webp, svg, pdf, doc, docx'));
    }
  }
});

// POST /sites/:siteId/upload - Upload a file to shared storage (with contextual classification)
app.post('/sites/:siteId/upload', upload.single('file'), async (req, res) => {
  try {
    const { siteId } = req.params;
    const { context = 'media', chat_session_id } = req.body; // context: "chat" or "media"
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    // Get site (for GitHub connection)
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    if (!site.github_repo || !site.github_token) {
      return res.status(400).json({ error: 'Site does not have GitHub repository configured' });
    }
    
    // Feature 3: Contextual classification
    if (context === 'chat') {
      // Chat context: Store temporarily, don't commit to GitHub
      console.log(`Upload in chat context (session: ${chat_session_id})`);
      
      // Store file in database as base64 or generate a temporary storage key
      const base64Content = req.file.buffer.toString('base64');
      
      const insertResult = await pool.query(
        `INSERT INTO chat_attachments 
         (session_id, site_id, filename, mimetype, size, storage_key, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW() + INTERVAL '30 days')
         RETURNING id`,
        [chat_session_id, siteId, req.file.originalname, req.file.mimetype, req.file.size, base64Content]
      );
      
      const attachmentId = insertResult.rows[0].id;
      
      // Return a reference URL the AI can understand
      res.json({
        success: true,
        context: 'chat',
        attachmentId,
        filename: req.file.originalname,
        type: req.file.mimetype,
        size: req.file.size,
        url: `/api/chat-attachments/${attachmentId}`,
        referenceUrl: `/api/chat-attachments/${attachmentId}`,
        message: 'File stored temporarily for chat reference (expires in 30 days)'
      });
      
    } else {
      // Media context: Commit to GitHub repo (permanent)
      console.log(`Upload in media context - committing to GitHub`);
      
      // Use abstracted storage layer (commits to GitHub)
      const result = await uploadFileToStorage(site, siteId, req.file);
      
      res.json({
        success: true,
        context: 'media',
        ...result
      });
    }
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/chat-attachments/:attachmentId - Retrieve a chat attachment
app.get('/api/chat-attachments/:attachmentId', async (req, res) => {
  try {
    const { attachmentId } = req.params;
    
    const result = await pool.query(
      'SELECT * FROM chat_attachments WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())',
      [attachmentId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found or expired' });
    }
    
    const attachment = result.rows[0];
    
    // Decode base64 content and send as file
    const buffer = Buffer.from(attachment.storage_key, 'base64');
    
    res.setHeader('Content-Type', attachment.mimetype);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename}"`);
    res.send(buffer);
    
  } catch (error) {
    console.error('Get attachment error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /sites/:siteId/uploads - List uploaded files for a site
app.get('/sites/:siteId/uploads', async (req, res) => {
  try {
    const { siteId } = req.params;
    
    // Get site (for GitHub connection)
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    if (!site.github_repo || !site.github_token) {
      return res.status(400).json({ error: 'Site does not have GitHub repository configured' });
    }
    
    // Use abstracted storage layer
    const files = await listSiteFiles(site, siteId);
    
    res.json({
      files
    });
    
  } catch (error) {
    console.error('List uploads error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Admin Email-Verified Login Flow
// ============================================================

/**
 * Send verification email via SendGrid or log to console
 * @param {string} email - Recipient email address
 * @string} verificationLink - Magic link with token
 * @param {string} siteId - Site identifier
 */
async function sendVerificationEmail(email, verificationLink, siteId) {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  
  if (!SENDGRID_API_KEY) {
    console.log('????????????????????????????????????????');
    console.log('??  SENDGRID_API_KEY not configured');
    console.log('?? Email verification link for:', email);
    console.log('?? Link:', verificationLink);
    console.log('????????????????????????????????????????');
    return { success: true, method: 'console' };
  }
  
  try {
    // Send email via SendGrid
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer `,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email }],
          subject: 'Admin Login Verification'
        }],
        from: {
          email: process.env.SENDGRID_FROM_EMAIL || 'noreply@themissites.com',
          name: 'Themis Sites'
        },
        content: [{
          type: 'text/html',
          value: `
            <h2>Admin Login Verification</h2>
            <p>Click the link below to complete your login:</p>
            <p><a href="" style="background-color: #4CAF50; color: white; padding: 14px 20px; text-decoration: none; display: inline-block; border-radius: 4px;">Verify & Login</a></p>
            <p>Or copy this link:</p>
            <p><code></code></p>
            <p><strong>This link expires in 10 minutes.</strong></p>
            <p>If you didn't request this login, you can safely ignore this email.</p>
          `
        }]
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('SendGrid error:', errorText);
      throw new Error(`SendGrid API error: `);
    }
    
    console.log(`??  Verification email sent to  via SendGrid`);
    return { success: true, method: 'sendgrid' };
    
  } catch (error) {
    console.error('Failed to send email via SendGrid:', error.message);
    console.log('????????????????????????????????????????');
    console.log('??  SendGrid failed, falling back to console');
    console.log('?? Email verification link for:', email);
    console.log('?? Link:', verificationLink);
    console.log('????????????????????????????????????????');
    return { success: true, method: 'console-fallback' };
  }
}

// POST /sites/:siteId/admin/login
// Step 1: Validate credentials, generate temp token, send verification email
app.post('/sites/:siteId/admin/login', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = 1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    // Validate credentials
    // TODO: Replace this with actual credential validation from database
    // For now, using environment variable for admin credentials
    const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@themissites.com';
    const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
    
    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      // Add a small delay to prevent timing attacks
      await new Promise(resolve => setTimeout(resolve, 1000));
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate temporary verification token (random 32 bytes)
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    
    // Store token in database
    await pool.query(
      'INSERT INTO admin_auth_tokens (email, token, expires_at) VALUES (1, 2, 3)',
      [email, token, expiresAt]
    );
    
    // Build verification link
    const baseUrl = process.env.BASE_URL || `http://localhost:`;
    const verificationLink = `/sites//admin/verify?token=`;
    
    // Send verification email
    const emailResult = await sendVerificationEmail(email, verificationLink, siteId);
    
    console.log(`?? Admin login initiated for  on site  (token expires in 10 min)`);
    
    res.json({
      success: true,
      message: 'Check your email for a verification link',
      emailMethod: emailResult.method,
      expiresIn: 600 // seconds
    });
    
  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /sites/:siteId/admin/verify
// Step 2: Validate temp token, return 24h JWT
app.get('/sites/:siteId/admin/verify', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ error: 'Verification token is required' });
    }
    
    // Look up token in database
    const tokenResult = await pool.query(
      'SELECT * FROM admin_auth_tokens WHERE token = 1 AND NOT used AND expires_at > NOW()',
      [token]
    );
    
    if (tokenResult.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired verification token' });
    }
    
    const authToken = tokenResult.rows[0];
    
    // Mark token as used
    await pool.query(
      'UPDATE admin_auth_tokens SET used = TRUE WHERE id = 1',
      [authToken.id]
    );
    
    // Generate 24-hour JWT
    const jwt = generateAdminJWT(authToken.email);
    
    console.log(`? Admin login verified for  on site  (JWT valid for 24h)`);
    
    // Return JWT in response
    // The frontend can store this in localStorage and use for authenticated requests
    res.json({
      success: true,
      token: jwt,
      email: authToken.email,
      expiresIn: 86400 // 24 hours in seconds
    });
    
  } catch (error) {
    console.error('Admin verify error:', error);
    res.status(500).json({ error: error.message });
  }
});


// Start server
app.listen(PORT, () => {
  console.log(`🤖 Site Builder AI running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
