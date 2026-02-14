# Site Builder AI

Multi-site AI builder service with chat interface and preview deployments.

## Features

- **Multi-tenant**: Support multiple sites from one service
- **AI Chat**: Natural language site editing via Claude
- **Preview Deployments**: Test changes before production
- **Git Integration**: Automatic branching and merging
- **Persistent Sessions**: Chat history survives restarts

## Architecture

```
Client Site (Admin Dashboard)
  ↓ HTTP POST
Site Builder AI (Railway VPS)
  ├─ PostgreSQL (sessions, chat history)
  ├─ Claude API (AI edits)
  ├─ GitHub (preview branches)
  └─ Vercel (auto-deploy previews)
```

## API Endpoints

### `POST /sites/:siteId/chat`
Send a message to the site editor AI.

**Request:**
```json
{
  "message": "Add a new Resources page between About and Contact"
}
```

**Response:**
```json
{
  "message": "I've created a new Resources page at /resources/. The page includes...",
  "sessionId": "securethevotemd-1234567890"
}
```

### `GET /sites/:siteId/history`
Get chat history for a site.

**Response:**
```json
{
  "sessionId": "securethevotemd-1234567890",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```

### `POST /sites/:siteId/preview`
Create a preview deployment.

**Response:**
```json
{
  "previewUrl": "https://secure-the-vote-preview-1234.vercel.app",
  "branch": "preview-1234567890"
}
```

### `POST /sites/:siteId/approve`
Merge preview to production.

**Request:**
```json
{
  "previewBranch": "preview-1234567890"
}
```

**Response:**
```json
{
  "status": "approved",
  "message": "Changes merged to production"
}
```

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Initialize database:**
   ```bash
   psql $DATABASE_URL < schema.sql
   ```

4. **Add first site:**
   ```sql
   INSERT INTO sites (id, domain, github_repo, github_token, vercel_project)
   VALUES (
     'securethevotemd',
     'securethevotemd.com',
     'RLooney88/Secure-the-Vote',
     'ghp_...',
     'secure-the-vote'
   );
   ```

5. **Run locally:**
   ```bash
   npm run dev
   ```

6. **Deploy to Railway:**
   - Push to GitHub
   - Connect repo in Railway dashboard
   - Add environment variables
   - Deploy

## Integration (Client Side)

Add chat UI to your admin dashboard:

```html
<div id="site-editor">
  <div id="chat-messages"></div>
  <input id="chat-input" type="text" placeholder="Ask the AI to edit your site..." />
  <button onclick="sendMessage()">Send</button>
</div>

<script>
const API_URL = 'https://site-builder-ai.up.railway.app';
const SITE_ID = 'securethevotemd';

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const message = input.value;
  input.value = '';
  
  const res = await fetch(`${API_URL}/sites/${SITE_ID}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message })
  });
  
  const data = await res.json();
  displayMessage('user', message);
  displayMessage('assistant', data.message);
}

function displayMessage(role, content) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = content;
  document.getElementById('chat-messages').appendChild(div);
}
</script>
```

## License

MIT
