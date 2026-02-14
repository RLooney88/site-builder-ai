# CMS Integration - Hybrid Editing System

**Status:** ✅ Implemented  
**Date:** 2026-02-13

## Overview

Site Builder AI now supports **dual editing modes** - users can edit content via either:
1. **CMS APIs** (database-driven content)
2. **Direct file editing** (static content)

The AI automatically routes requests to the correct system based on content type.

## How It Works

### Smart Routing

The AI analyzes each request and chooses the appropriate method:

| Content Type | Method | APIs Used |
|--------------|--------|-----------|
| Blog posts | CMS API | `/api/admin/posts`, `/api/admin/post-publish` |
| Banner (marquee) | CMS API | `/api/admin/banner-settings` |
| Petitions | CMS API | `/api/admin/petitions` |
| Static pages | GitHub | File edit → preview branch |
| CSS/JavaScript | GitHub | File edit → preview branch |
| Navigation/Footer | GitHub | File edit → preview branch |

### Authentication

- AI generates JWT tokens using the site's `jwtSecret`
- JWT tokens included in `Authorization: Bearer {token}` header
- Tokens valid for 1 hour
- Same authentication as admin dashboard users

## Implementation Details

### 1. JWT Token Generation

**File:** `lib/jwt.js`

```javascript
export function generateJWT(siteConfig, payload = {}) {
  const secret = siteConfig.jwtSecret || process.env.JWT_SECRET;
  return jwt.sign(
    { email: 'ai@sitebuilder.local', role: 'admin', ...payload },
    secret,
    { expiresIn: '1h' }
  );
}
```

### 2. Enhanced System Prompt

The AI receives comprehensive documentation about:
- All available CMS API endpoints
- Request/response formats
- When to use CMS vs file editing
- Authentication requirements

**Example prompt section:**
```
**Blog Posts:**
- List: GET /api/admin/posts
- Create: POST /api/admin/posts
  Body: { title, content, category, ... }
- Publish: POST /api/admin/post-publish?id={id}

**CRITICAL:** When user asks to edit blog posts:
1. Use the CMS APIs above
2. DO NOT edit HTML files directly
3. The CMS generates HTML automatically
```

### 3. Site Configuration

Each site in the database has a `config` JSONB field:

```json
{
  "cmsApiUrl": "https://secure-the-vote.vercel.app",
  "jwtSecret": "STVmd2026-jwt-secret-key",
  "systemPrompt": "Site-specific instructions..."
}
```

**Critical:** `jwtSecret` must match the `JWT_SECRET` environment variable in the CMS's Vercel deployment.

## Example Workflows

### Blog Post Creation via AI

```
User: "Add a new blog post about the new voting laws"

AI thinks: This is blog content → Use CMS API

AI calls:
POST https://secure-the-vote.vercel.app/api/admin/posts
Authorization: Bearer eyJhbGc...
Content-Type: application/json

{
  "title": "New Voting Laws in Maryland",
  "content": "...",
  "category": "news",
  "seoTitle": "New Voting Laws | Secure The Vote MD",
  "seoDescription": "..."
}

Response: { id: 123, ... }

AI calls:
POST https://secure-the-vote.vercel.app/api/admin/post-publish?id=123

CMS: Generates HTML at dist/2026/02/13/new-voting-laws/index.html

AI responds: "✅ Blog post published! Live at: /2026/02/13/new-voting-laws/"
```

### Homepage Edit via GitHub

```
User: "Change the homepage hero text to 'Secure Your Vote 2026'"

AI thinks: This is static content → Edit file directly

AI:
1. Fetches src/index.njk from GitHub
2. Updates the hero text
3. Creates preview branch: preview-2026-02-13-2115
4. Pushes changes to preview branch
5. Vercel auto-deploys preview

AI responds:
"✅ Homepage updated
📍 File: src/index.njk
🔗 Preview: https://secure-the-vote-git-preview-2026-02-13-2115.vercel.app
⏭️ Review and approve to publish"
```

## Configuration Requirements

### Railway Environment Variables

**Required:**
- `DATABASE_URL` - PostgreSQL connection
- `CLAUDE_API_KEY` - Anthropic API key
- `GITHUB_TOKEN` - GitHub PAT for repo access
- `JWT_SECRET` - **Must match the Vercel JWT_SECRET** for CMS authentication

### Vercel Environment Variables (SecureTheVoteMD)

**Required:**
- `DATABASE_URL` - Railway Postgres
- `JWT_SECRET` - **Must match Railway JWT_SECRET**
- `SENDGRID_API_KEY` - Email functionality
- `GITHUB_TOKEN` - For auto-deploy features

## Benefits

### For Users
- ✅ Choose preferred interface (CMS dashboard or AI chat)
- ✅ No conflicts between systems
- ✅ Blog posts always editable via familiar CMS
- ✅ Complex site changes possible via natural language

### For Developers
- ✅ CMS remains authoritative for its content
- ✅ No data synchronization needed
- ✅ Clear separation of concerns
- ✅ Both systems work independently

## Limitations

### Current Scope
- AI can READ all CMS data (posts, banners, petitions)
- AI can CREATE/UPDATE blog posts and publish them
- AI can UPDATE banner settings
- AI CANNOT delete admins or modify admin permissions
- AI CANNOT export signatures or modify petition submissions

### Future Enhancements
- [ ] AI-powered SEO optimization (auto-generate titles/descriptions)
- [ ] Bulk operations (edit multiple posts at once)
- [ ] Content templates ("create a press release about X")
- [ ] Image upload and optimization
- [ ] A/B testing support

## Testing

### Test Blog Post Creation

```bash
curl -X POST https://site-builder-ai-production.up.railway.app/sites/securethevotemd/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Create a blog post about election security with title \"Protecting Your Vote\" and category \"news\""}'
```

Expected: AI calls CMS API, creates post, publishes HTML

### Test Static Page Edit

```bash
curl -X POST https://site-builder-ai-production.up.railway.app/sites/securethevotemd/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Update the contact page to add our phone number (443) 328-0779"}'
```

Expected: AI edits src/contact.njk, creates preview branch

## Troubleshooting

### "Unauthorized" errors when AI calls CMS API

**Cause:** JWT_SECRET mismatch between Railway and Vercel

**Fix:**
1. Check Railway env var: `JWT_SECRET`
2. Check Vercel env var: `JWT_SECRET`
3. Ensure they match exactly
4. Redeploy both services

### AI edits blog HTML instead of using CMS API

**Cause:** System prompt not loaded or AI confused

**Fix:**
1. Check site config in database: `SELECT config FROM sites WHERE id = 'securethevotemd'`
2. Verify `systemPrompt` includes CMS routing rules
3. Test with explicit instruction: "Use the CMS API to create a blog post"

### CMS doesn't recognize AI's JWT token

**Cause:** Token format or payload incorrect

**Fix:**
1. Check JWT payload matches admin user structure
2. Verify `email` and `role` fields present
3. Ensure token not expired (1 hour default)

---

**Implementation Time:** ~40 minutes  
**Complexity:** Low (leverages existing APIs)  
**Dependencies:** jsonwebtoken (added to package.json)  
**Status:** ✅ Ready for testing
