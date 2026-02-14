import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import pg from 'pg';
import Anthropic from '@anthropic-ai/sdk';
import simpleGit from 'simple-git';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import dotenv from 'dotenv';
import { generateJWT, getCMSBaseURL } from './lib/jwt.js';
import { createBranch, getVercelPreviewURL, mergeBranch, deleteBranch } from './lib/github.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Database setup
const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL?.trim(),
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
    const session = await getSession(siteId);
    const history = await getChatHistory(session.id, 50);
    
    res.json({
      sessionId: session.id,
      messages: history
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
    
    // Create preview branch
    const branchName = `preview-${Date.now()}`;
    
    console.log(`Creating preview branch: ${branchName}`);
    
    await createBranch(site.github_repo, site.github_token, branchName);
    
    // Generate Vercel preview URL
    // Format: https://{project}-git-{branch}.vercel.app
    const previewUrl = getVercelPreviewURL(site.vercel_project, branchName);
    
    console.log(`Preview URL: ${previewUrl}`);
    
    // Save edit record
    await pool.query(
      'INSERT INTO edits (session_id, file_path, change_description, preview_url, preview_branch) VALUES ($1, $2, $3, $4, $5)',
      [session.id, files.join(', ') || 'AI changes', 'Preview deployment', previewUrl, branchName]
    );
    
    res.json({
      previewUrl,
      branch: branchName,
      message: 'Preview branch created. Vercel will deploy automatically in ~30 seconds.'
    });
  } catch (error) {
    console.error('Preview error:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST /sites/:siteId/approve
app.post('/sites/:siteId/approve', async (req, res) => {
  try {
    const { siteId } = req.params;
    const { previewBranch } = req.body;
    
    if (!previewBranch) {
      return res.status(400).json({ error: 'Preview branch is required' });
    }
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    console.log(`Merging ${previewBranch} to main`);
    
    // Merge preview branch to main
    await mergeBranch(
      site.github_repo, 
      site.github_token, 
      previewBranch,
      `Approve AI changes from ${previewBranch}`
    );
    
    // Mark as approved
    await pool.query(
      'UPDATE edits SET approved = true, deployed_at = NOW() WHERE preview_branch = $1',
      [previewBranch]
    );
    
    console.log(`Merged to main. Cleaning up preview branch...`);
    
    // Clean up preview branch (optional - can keep for history)
    try {
      await deleteBranch(site.github_repo, site.github_token, previewBranch);
      console.log(`Preview branch ${previewBranch} deleted`);
    } catch (cleanupError) {
      console.warn(`Could not delete preview branch: ${cleanupError.message}`);
      // Non-fatal - continue
    }
    
    res.json({ 
      status: 'approved', 
      message: 'Changes merged to production. Vercel will deploy to live site in ~30 seconds.',
      productionUrl: `https://${site.vercel_project}.vercel.app`
    });
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🤖 Site Builder AI running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/health`);
});
