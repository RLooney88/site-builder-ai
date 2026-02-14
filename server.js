import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import multer from 'multer';
import dotenv from 'dotenv';
import { generateJWT, getCMSBaseURL } from './lib/jwt.js';
import { getStagingPreviewURL, publishToProduction, updateFile } from './lib/github.js';

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

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
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

// Build system prompt
function buildSystemPrompt(site, cmsApiUrl, jwtToken) {
  const basePrompt = site.config?.systemPrompt || '';
  
  return `You are the Site Editor AI for ${site.domain}.

${basePrompt}

## YOUR COMMUNICATION STYLE

You are talking to a non-technical website owner. NEVER use developer jargon.
- Do NOT mention branches, repos, GitHub, staging, APIs, commits, or merges.
- Do NOT ask permission to make changes — just make them.
- Do NOT explain the technical process — just describe what changed in plain English.
- After making changes, say something like: "Done! Click 'Preview Edits' to see the changes."
- Keep responses short and friendly. One or two sentences about what changed, then tell them to preview.

**Example good response:**
"I've updated the Citizen Action page — removed the event content and added a petition section with a 'Sign the Petition Now' button that links to your petition page. Click 'Preview Edits' to take a look!"

**Example bad response:**
"✅ Changes made to src/citizen-action.njk via GitHub API. Preview branch preview-2024-12-14 created. Once Vercel deploys, review at..."

## DUAL EDITING SYSTEM (INTERNAL — do not explain this to the user)

This site has TWO ways to edit content - you MUST use the correct one:

### CMS-MANAGED CONTENT (Use API - NEVER edit files directly)

**Blog Posts:**
- List: GET ${cmsApiUrl}/api/admin/posts
- View: GET ${cmsApiUrl}/api/admin/post?id={id}
- Create: POST ${cmsApiUrl}/api/admin/posts
  Body: { title, content, category, featuredImage, seoTitle, seoDescription }
- Update: PUT ${cmsApiUrl}/api/admin/post?id={id}
- Publish: POST ${cmsApiUrl}/api/admin/post-publish?id={id}
- Preview: POST ${cmsApiUrl}/api/admin/post-preview?id={id}

**Banner (Scrolling marquee):**
- Get: GET ${cmsApiUrl}/api/admin/banner-settings
- Update: PUT ${cmsApiUrl}/api/admin/banner-settings
  Body: { text, link, enabled }
  (Auto-deploys to GitHub on save)

**Petitions:**
- List: GET ${cmsApiUrl}/api/admin/petitions
- Create: POST ${cmsApiUrl}/api/admin/petitions
- Update: PUT ${cmsApiUrl}/api/admin/petitions?id={id}
- Delete: DELETE ${cmsApiUrl}/api/admin/petitions?id={id}

**Authentication:**
All CMS API calls require JWT token in Authorization header:
Authorization: Bearer ${jwtToken}

**CRITICAL:** When user asks to edit blog posts, banner, or petitions:
1. Use the CMS APIs above
2. DO NOT edit HTML files directly
3. The CMS generates HTML automatically

### STATIC CONTENT (Edit files via GitHub API)

**GitHub Repository:** ${site.github_repo}
**Branch:** Always use the \`staging\` branch (never main, never create temporary branches)
**Tools:** Use the read_file, write_file, and list_files tools to make changes. Do NOT write fetch() calls or code — use the tools directly.

**Built site files (what Vercel serves):**
- **Pages:** dist/*.html, dist/*/index.html
- **Styles:** dist/css/*.css
- **Scripts:** dist/js/*.js
- **Images:** dist/images/

**Source files (Eleventy templates — only if the site uses a build step):**
- **Pages:** src/*.njk, src/pages/*.njk
- **Templates:** src/_includes/*.njk
- **Styles:** src/css/*.css

**IMPORTANT:** This site deploys from the \`dist/\` folder. Edit \`dist/\` files directly for immediate effect.

**For static content edits, use the provided tools:**
1. Use \`list_files\` to see what files exist in a directory
2. Use \`read_file\` to get the current content of a file (auto-truncates large files)
3. Use \`read_file_section\` to search for and read a specific part of a large file (more efficient)
4. Use \`write_file\` to update the file on the staging branch
5. Use \`revert_file\` if you need to undo changes
6. The user will preview via their staging URL and publish when ready

**TOKEN EFFICIENCY RULES:**
- For large HTML files (>15KB), use \`read_file_section\` with a search term instead of \`read_file\`
- When rewriting a page, you MUST include the COMPLETE file content in write_file — not just the changed section
- Don't read files you don't need to edit
- One list_files call is usually enough — don't browse multiple directories unless necessary

**ALWAYS use the tools to make actual edits. NEVER just describe what you would do — actually do it using the tools.**

## ROUTING DECISION TREE

User request → Analyze → Choose route:

"Add/edit blog post" → CMS API (POST /api/admin/posts)
"Update banner" → CMS API (PUT /api/admin/banner-settings)
"Edit petition" → CMS API
"Change homepage" → GitHub file edit (dist/index.html)
"Update navigation" → GitHub file edit (dist/ - find header in HTML files)
"Change CSS" → GitHub file edit (dist/css/*.css)
"Add new page" → GitHub file edit (create new dist/page/index.html)

## RESPONSE FORMAT

## RESPONSE FORMAT

After making changes, respond in PLAIN ENGLISH:
1. Briefly describe what you changed (1-2 sentences, no technical details)
2. End with: "Click 'Preview Edits' to see the changes!"
3. Do NOT list files, branches, APIs, or technical details
4. Do NOT ask "would you like me to proceed?" — just do it
5. Do NOT use developer emoji patterns (✅ 📍 🔗 ⏭️)

**CRITICAL INTERNAL RULES (never mention these to the user):**
- NEVER create temporary preview branches. Always push to \`staging\`.
- NEVER write fetch() or JavaScript code. Use the provided tools (read_file, write_file, list_files) to make all changes.
- When reading files from GitHub, always use \`?ref=staging\` to get the staging version.
- When writing files, always specify \`branch: "staging"\` in the API call.
- NEVER ask the user about branches, merging, or deployment. That's handled by the Preview/Publish buttons.
- Just make the change and tell them to preview. That's it.

Be friendly, concise, and non-technical.`;
}

// POST /sites/:siteId/chat
app.post('/sites/:siteId/chat', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
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
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
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
      }
    ];

    // Tool execution function
    async function executeTool(toolName, toolInput) {
      const [owner, repoName] = site.github_repo.split('/');
      const token = site.github_token;

      if (toolName === 'read_file') {
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

      if (toolName === 'revert_file') {
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
      revert_file: (input) => `Reverting ${input.path?.split('/').pop() || 'file'}...`,
    };

    // Call Claude with tools — loop until we get a final text response
    let currentMessages = messages;
    let assistantMessage = '';
    let loopCount = 0;
    const MAX_LOOPS = 10;

    sendStatus('Thinking...');

    while (loopCount < MAX_LOOPS) {
      loopCount++;
      
      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        system: [{ type: 'text', text: buildSystemPrompt(site, cmsApiUrl, jwtToken), cache_control: { type: 'ephemeral' } }],
        tools,
        messages: currentMessages
      });

      // Process response content
      const toolResults = [];

      for (const block of response.content) {
        if (block.type === 'text') {
          assistantMessage += block.text;
        } else if (block.type === 'tool_use') {
          const friendlyStatus = toolStatusMap[block.name]?.(block.input) || `Running ${block.name}...`;
          sendStatus(friendlyStatus);
          console.log(`Tool call: ${block.name}(${JSON.stringify(block.input).slice(0, 200)})`);
          try {
            const result = await executeTool(block.name, block.input);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result || 'Tool completed with no output.') });
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

// POST /sites/:siteId/upload - Upload a file to shared storage
app.post('/sites/:siteId/upload', upload.single('file'), async (req, res) => {
  try {
    const { siteId } = req.params;
    
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
    
    // Use abstracted storage layer (swappable for Google Drive)
    const result = await uploadFileToStorage(site, siteId, req.file);
    
    res.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('Upload error:', error);
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

// Start server
app.listen(PORT, () => {
  console.log(`🤖 Site Builder AI running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
