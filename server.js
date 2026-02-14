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
  
  // Convert file buffer to base64
  const fileContent = file.buffer.toString('base64');
  
  // Commit file to GitHub staging branch
  await updateFile(
    site.github_repo,
    site.github_token,
    uploadPath,
    fileContent,
    `Upload: ${file.originalname}`,
    'staging'
  );
  
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

## DUAL EDITING SYSTEM

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

**Pages:** src/*.njk, src/pages/*.njk
**Templates:** src/_includes/*.njk
**Styles:** src/css/*.css
**Scripts:** src/js/*.js
**Navigation:** src/_includes/header.njk
**Footer:** src/_includes/footer.njk

**For static content:**
1. Edit via GitHub API
2. Create preview branch (preview-YYYY-MM-DD-HHMM)
3. Vercel auto-deploys preview
4. Get approval before merging to main

## ROUTING DECISION TREE

User request → Analyze → Choose route:

"Add/edit blog post" → CMS API (POST /api/admin/posts)
"Update banner" → CMS API (PUT /api/admin/banner-settings)
"Edit petition" → CMS API
"Change homepage" → GitHub file edit (src/index.njk)
"Update navigation" → GitHub file edit (src/_includes/header.njk)
"Change CSS" → GitHub file edit (src/css/*.css)
"Add new page" → GitHub file edit (create new .njk)

## RESPONSE FORMAT

After making changes, respond with:
✅ What was changed
📍 Where it was changed (CMS vs GitHub)
🔗 Preview URL (if applicable)
⏭️ Next steps

Be concise and professional.`;
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
    
    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: buildSystemPrompt(site, cmsApiUrl, jwtToken),
      messages
    });
    
    const assistantMessage = response.content[0].text;
    
    // Save assistant message
    await saveMessage(session.id, 'assistant', assistantMessage);
    
    // Update session timestamp
    await pool.query('UPDATE sessions SET updated_at = NOW() WHERE id = $1', [session.id]);
    
    res.json({
      message: assistantMessage,
      sessionId: session.id
    });
    
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

// POST /sites/:siteId/upload - Upload a file to the site's GitHub repo
app.post('/sites/:siteId/upload', upload.single('file'), async (req, res) => {
  try {
    const { siteId } = req.params;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No file provided' });
    }
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    if (!site.github_repo || !site.github_token) {
      return res.status(400).json({ error: 'Site does not have GitHub repository configured' });
    }
    
    const file = req.file;
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const uploadPath = `dist/uploads/${year}/${month}/${file.originalname}`;
    
    // Commit file to GitHub staging branch using Contents API directly
    // (updateFile double-encodes base64, so we call GitHub API directly for binary files)
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
    const publicUrl = `/uploads/${year}/${month}/${file.originalname}`;
    
    res.json({
      success: true,
      url: publicUrl,
      path: uploadPath,
      name: file.originalname,
      size: file.size,
      type: file.mimetype
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /sites/:siteId/uploads - List uploaded files
app.get('/sites/:siteId/uploads', async (req, res) => {
  try {
    const { siteId } = req.params;
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    if (!site.github_repo || !site.github_token) {
      return res.status(400).json({ error: 'Site does not have GitHub repository configured' });
    }
    
    const [owner, repoName] = site.github_repo.split('/');
    const uploads = [];
    
    // Try to get the tree of dist/uploads/
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
        
        // Filter for files (not directories) and build upload list
        // Tree paths are relative to dist/uploads/, e.g. "2026/02/image.png"
        for (const item of treeData.tree || []) {
          if (item.type === 'blob') {
            const pathParts = item.path.split('/');
            if (pathParts.length < 3) continue; // Need YYYY/MM/filename
            const year = pathParts[0];
            const month = pathParts[1];
            const filename = pathParts[pathParts.length - 1];
            
            uploads.push({
              name: filename,
              path: item.path,
              url: `/uploads/${year}/${month}/${filename}`,
              size: item.size,
              sha: item.sha
            });
          }
        }
        
        // Sort by path descending (newest first)
        uploads.sort((a, b) => b.path.localeCompare(a.path));
      }
    } catch (treeError) {
      console.warn('Could not fetch uploads tree:', treeError.message);
    }
    
    res.json({
      files: uploads
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
