# Site Builder AI - Project Status

**Last Updated:** 2026-02-13 21:13 EST

## Overview

**Site Builder AI** is a multi-tenant AI-powered website builder service that provides natural language editing capabilities for static websites via chat interface.

**Current Deployment:** https://site-builder-ai-production.up.railway.app

## Architecture

**Backend:**
- Node.js + Express API
- PostgreSQL database (Railway)
- Claude API integration (Anthropic)
- GitHub API for file editing
- Vercel API for preview deployments

**Database Tables:**
- `sites` - Client website configurations
- `sessions` - Isolated chat sessions per site
- `messages` - Full conversation history
- `edits` - File change tracking with preview/approval workflow

**Environment Variables:**
- `DATABASE_URL` - Railway Postgres connection (⚠️ PENDING - needs to be added manually)
- `CLAUDE_API_KEY` - ✅ Configured
- `GITHUB_TOKEN` - ✅ Configured
- `NODE_ENV` - ✅ Configured (production)
- `PORT` - ✅ Auto-set by Railway

## Current Status

### ✅ Completed
- [x] Express API server created
- [x] Database schema designed and deployed
- [x] Claude API integration implemented
- [x] GitHub token configured for repo access
- [x] Railway deployment successful
- [x] SecureTheVoteMD site registered in database
- [x] **CMS API integration** - Hybrid editing system (2026-02-13 21:18 EST)
  - AI can use CMS APIs for blog posts, banners, petitions
  - AI can edit static files via GitHub for pages, CSS, JS
  - Smart routing based on content type
  - JWT authentication for CMS API calls

### ⚠️ Pending
- [ ] **DATABASE_URL environment variable** - Must be added manually via Railway UI
  - Railway API mutations blocked (auth issues)
  - Manual add: Railway dashboard → site-builder-ai → Variables → Add `DATABASE_URL`
  - Value: `postgresql://postgres:jpMUheDiuKdrdvCtlNqARXRiCdeOhZXI@caboose.proxy.rlwy.net:48174/railway`
- [ ] Chat UI integration into SecureTheVoteMD admin dashboard
- [ ] Preview branch workflow testing
- [ ] Full end-to-end workflow test

### 🚫 Blocked
- Railway GraphQL API mutations (Not Authorized errors)
  - See: `index/problems/railway-api-database-provisioning.md`
  - Workaround: Manual UI configuration

## First Client: SecureTheVoteMD

**Site ID:** `securethevotemd`
**Domain:** securethevotemd.com
**GitHub Repo:** RLooney88/Secure-the-Vote
**Vercel Project:** Secure-the-Vote

**System Prompt:** Configured with site structure, editing rules, and workflow

**Capabilities:**
- Edit Eleventy templates (.njk files)
- Modify CSS stylesheets
- Update blog posts
- Create preview branches
- Auto-deploy to Vercel
- Approval workflow for production merges

## API Endpoints

**Base URL:** https://site-builder-ai-production.up.railway.app

### `/sites/:siteId/chat` (POST)
Send chat message, get AI response with file edits

**Request:**
```json
{
  "message": "Update the homepage title to 'Secure Your Vote 2026'"
}
```

**Response:**
```json
{
  "response": "I'll update the homepage title...",
  "edits": [
    {
      "filePath": "src/index.njk",
      "description": "Updated title"
    }
  ]
}
```

### `/sites/:siteId/history` (GET)
Load chat history for a site

### `/sites/:siteId/preview` (POST)
Create preview branch and return Vercel preview URL

### `/sites/:siteId/approve` (POST)
Merge preview to production

## Workflow

1. **User sends chat message** via admin dashboard
2. **AI analyzes request** using site-specific system prompt
3. **Files are edited** via GitHub API (creates preview branch)
4. **Vercel auto-deploys** preview URL
5. **User reviews** preview deployment
6. **On approval** → AI merges to main → production deploy

## Next Steps

1. **Add DATABASE_URL to Railway** (manual UI step)
2. **Build chat UI** in SecureTheVoteMD admin dashboard
3. **Test full workflow** end-to-end
4. **Deploy chat UI** to production
5. **User acceptance testing** with client

## Known Issues

### Railway API Permissions
- **Problem:** GraphQL mutations fail with "Not Authorized"
- **Impact:** Cannot add environment variables programmatically
- **Workaround:** Manual configuration via Railway UI
- **Documented:** `index/problems/railway-api-database-provisioning.md`

## Credentials

All credentials stored encrypted:
- `secrets/roddy/sitebuilder-database.json.enc` - Database connection
- `secrets/roddy/anthropic-api-key.json` - Claude API
- `secrets/roddy/github-token.json` - GitHub PAT

## Repository

**Location:** `repos/site-builder-ai/`

**Key Files:**
- `server.js` - Express API server
- `schema.sql` - Database schema
- `README.md` - Setup and usage documentation
- `.env.example` - Environment variable template

## Timeline

- **2026-02-13 20:23 EST** - Project created
- **2026-02-13 20:33 EST** - Railway deployment initiated
- **2026-02-13 20:45 EST** - Claude API key added
- **2026-02-13 21:10 EST** - Database provisioned and schema created
- **2026-02-13 21:13 EST** - SecureTheVoteMD site registered

**Total development time:** ~50 minutes

## Architecture Decision Records

### Multi-Tenant Database Design
**Decision:** Single database with `sites` table for all clients
**Rationale:** 
- Simpler infrastructure management
- Easier to scale initially
- Lower cost (one database vs many)
- Isolated sessions per site prevent data leakage

**Trade-off:** Clients share database infrastructure
**Mitigation:** Row-level security via site_id references

### Preview Branch Workflow
**Decision:** Always create preview branches before production merges
**Rationale:**
- Client review before going live
- Safer deployment pipeline
- Vercel auto-deploys previews
- Easy rollback if needed

---

**Status Summary:** 
- Backend: ✅ Deployed and running
- Database: ✅ Provisioned with schema
- Configuration: ⚠️ DATABASE_URL needs manual add
- Frontend: 🔜 Not yet built
- End-to-end: 🔜 Not yet tested
