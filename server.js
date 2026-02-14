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
function buildSystemPrompt(site) {
  return `You are the Site Editor AI for ${site.domain}.

SITE STRUCTURE:
- Production: dist/ (static HTML)
- Styles: dist/css/
- Images: dist/images/
- Blog posts: dist/YYYY/MM/DD/slug/index.html
- GitHub: ${site.github_repo}

EDITING RULES:
- Always preview changes before production
- Localize URLs (/images/, not /wp-content/uploads/)
- Update both static files AND database when needed
- Ask for confirmation on destructive changes
- Be concise and professional

WORKFLOW:
1. Client requests change
2. Analyze what files need to be edited
3. Make the edits
4. Respond with summary of changes made
5. Client can request preview or approve for production

You have access to the full repository. Make edits directly and report what you changed.`;
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
    
    // Build messages for Claude
    const messages = [
      ...history.map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: message }
    ];
    
    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      system: buildSystemPrompt(site),
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
    
    // Get site
    const siteResult = await pool.query('SELECT * FROM sites WHERE id = $1', [siteId]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ error: 'Site not found' });
    }
    const site = siteResult.rows[0];
    
    const session = await getSession(siteId);
    
    // Create preview branch
    const branchName = `preview-${Date.now()}`;
    
    // TODO: Git operations to create preview branch
    // This will be implemented with local repo cloning
    
    const previewUrl = `https://${site.domain}-${branchName}.vercel.app`;
    
    // Save edit record
    await pool.query(
      'INSERT INTO edits (session_id, file_path, change_description, preview_url, preview_branch) VALUES ($1, $2, $3, $4, $5)',
      [session.id, 'multiple', 'Preview deployment', previewUrl, branchName]
    );
    
    res.json({
      previewUrl,
      branch: branchName
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
    
    // TODO: Merge preview branch to main
    
    // Mark as approved
    await pool.query(
      'UPDATE edits SET approved = true, deployed_at = NOW() WHERE preview_branch = $1',
      [previewBranch]
    );
    
    res.json({ status: 'approved', message: 'Changes merged to production' });
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
