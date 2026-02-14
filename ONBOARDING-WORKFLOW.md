# Site Builder AI - Onboarding Workflow

**Estimated Total Time:** ~3 hours for a new client  
**Last Updated:** 2026-02-14

> This workflow streamlines client onboarding based on lessons from the SecureTheVoteMD deployment (which took all day due to first-time issues).

---

## Quick Start

**For the next client, follow these phases in order. Don't skip.**

| Phase | Who | Duration | Blocker? |
|-------|-----|----------|----------|
| Phase 0: Roddy's Pre-Work | Roddy | 10 min | YES - blocks everything |
| Phase 1: Site Crawl & Content Capture | Aster | 30 min | |
| Phase 2: Static Site Build | Aster | 1-2 hours | |
| Phase 3: Database & Backend Setup | Aster | 30 min | |
| Phase 4: Vercel Project Setup | Aster | 15 min | |
| Phase 5: Integration Testing | Aster + Roddy | 15 min | |
| Phase 6: Domain & Go-Live | Roddy | 10 min | |

---

## Phase 0: Roddy's Pre-Work

**Duration:** 10 minutes  
**Owner:** Roddy  
**Status:** [ ]

> ⚠️ **BLOCKER PHASE** - Complete all these before Aster starts. Aster cannot proceed without them.

### [ ] Create Railway project and service

```
Railway dashboard → New Project → Deploy from GitHub repo
- Select the site-builder-ai repo
- Service name: site-builder-ai
```

**Why:** Aster's API token returns 0 projects — can't create via API.

### [ ] Set environment variables in Railway dashboard

**Location:** Railway → site-builder-ai project → site-builder-ai service → Variables

| Variable | Value | Source |
|----------|-------|--------|
| `DATABASE_URL` | `postgresql://postgres:...@caboose.proxy.rlwy.net:48174/railway` | secrets/roddy/sitebuilder-database.json |
| `ANTHROPIC_API_KEY` | (key) | secrets/roddy/anthropic-api-key.json |
| `GITHUB_TOKEN` | (PAT with repo scope) | secrets/roddy/github-token.json |
| `JWT_SECRET` | Generate new random string | Record for Vercel later |

**Why:** Railway API mutations fail — must set manually in dashboard.

### [ ] Create GitHub repo for the new site

```
GitHub → New Repository → site-builder-ai-template (or client name)
- Make it private
- Initialize with README
```

### [ ] Share FTP/hosting credentials for the existing site

**Provide to Aster:**
- FTP/SFTP hostname, username, password OR
- WordPress admin credentials OR
- Current hosting panel access

**Why:** Need to crawl the live site directly — not from backups.

### [ ] Provide domain info and DNS access

| Info | Needed For |
|------|------------|
| Domain name | Site config in database |
| DNS provider (Cloudflare, GoDaddy, etc.) | Pointing to Vercel |
| DNS login credentials | Creating records |

---

## Phase 1: Site Crawl & Content Capture

**Duration:** 30 minutes  
**Owner:** Aster  
**Status:** [ ]

> 🔴 **CRITICAL LESSON:** Always crawl the live site directly — never trust backups or old FTP dumps. We lost hours on stale content during the first onboarding.

### [ ] Crawl the existing live site (not backups, not FTP)

```
Use browser automation or wget to fetch:
- Every public page
- All CSS files
- All JavaScript files
- All images and assets
- All forms (contact, petition, etc.)
```

### [ ] Capture page structure and navigation

```
Document:
- All top-level pages (Home, About, Contact, etc.)
- Sub-pages and their hierarchy
- Navigation menu structure
- Footer links and sections
```

### [ ] Identify dynamic features

| Feature | Action |
|---------|--------|
| Blog posts | Note CMS platform (WordPress, custom, etc.) |
| Contact forms | Capture form fields, endpoints |
| Petitions | Capture form fields, signature storage |
| Calendars | Note platform or custom implementation |
| Newsletter signup | Capture provider and form details |
| Event registrations | Capture flow and data storage |

### [ ] Screenshot key pages for design reference

```
- Homepage (desktop + mobile)
- 2-3 content pages
- Blog listing and single post
- Contact page
- Any forms (petition, signup)
```

### [ ] Export content to Markdown/HTML

```
For each page:
- Extract text content
- Note image locations
- Preserve links and formatting
- Save as src/pages/*.md or similar
```

---

## Phase 2: Static Site Build

**Duration:** 1-2 hours  
**Owner:** Aster  
**Status:** [ ]

### [ ] Set up Eleventy project structure

```
New project from site-builder-ai template:
- src/
  - _includes/ (layouts, partials)
  - _data/ (site data)
  - pages/ (content pages)
  - blog/ (blog posts)
  - css/
  - js/
- .eleventy.js
- package.json
```

### [ ] Build layouts matching original design

```
Create base layout with:
- Header with navigation
- Footer with links
- Common meta tags
- CSS/JS includes
```

### [ ] Convert crawled content to Eleventy templates

```
For each page:
- Create corresponding .njk file in src/pages/
- Insert extracted content
- Match original HTML structure
- Preserve semantic markup
```

### [ ] Set up CSS/JS (copied from crawl)

```
- Copy all CSS files to src/css/
- Copy all JS files to src/js/
- Fix any relative paths
- Test styles apply correctly
```

### [ ] Build admin dashboard with all tabs

```
Admin panel must include:
- Dashboard (overview)
- Pages (edit static content)
- Posts (blog management)
- Media (file uploads)
- Settings (site config)
- AI Chat (site editing interface)
```

### [ ] Configure serverless API functions

| Function | Purpose |
|----------|---------|
| Auth (login, JWT generation) | Admin authentication |
| Posts CRUD | Blog post management |
| Banner settings | Marquee content |
| Petition management | Form and signature tracking |
| File upload | Image/media management |
| AI chat proxy | Site Builder AI integration |

### [ ] Commit initial build to GitHub

```
git add .
git commit -m "Initial static site build from crawl"
git push origin main
```

---

## Phase 3: Database & Backend Setup

**Duration:** 30 minutes  
**Owner:** Aster  
**Status:** [ ]

### [ ] Run database migrations on Railway

```sql
-- Connect to Railway PostgreSQL and run schema.sql
-- Tables created:
-- - sites (client configurations)
-- - sessions (chat sessions)
-- - messages (conversation history)
-- - edits (file change tracking)
```

### [ ] Add site record to sites table

```sql
INSERT INTO sites (
  id,
  github_repo,
  github_token,
  vercel_project_id,
  vercel_token,
  domain,
  config
) VALUES (
  'clientname',
  'org/repo',
  'ghp_...',  -- From Roddy's pre-work
  'proj_...', -- From Vercel setup
  'vercel_token_...',
  'clientdomain.com',
  '{
    "cmsApiUrl": "https://clientdomain.vercel.app",
    "jwtSecret": "from-railway-jwt-secret",
    "systemPrompt": "Site-specific instructions..."
  }'::jsonb
);
```

### [ ] Verify all API endpoints work

```bash
# Test each endpoint:
curl https://site-builder-ai-production.up.railway.app/health
curl https://site-builder-ai-production.up.railway.app/sites/clientname/history
```

### [ ] Test Anthropic API key is valid

```bash
# Send a test message and check for 401 errors
curl -X POST https://site-builder-ai-production.up.railway.app/sites/clientname/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'

# Expected: Valid AI response
# Bad: 401 {"type":"error","error":{"type":"authentication_error"}}
```

---

## Phase 4: Vercel Project Setup

**Duration:** 15 minutes  
**Owner:** Aster  
**Status:** [ ]

### [ ] Create Vercel project connected to GitHub repo

```
Vercel dashboard → Add New Project → Import from GitHub
- Select the client repo created in Phase 0
- Framework: Other (or detect)
- Root Directory: . (or client-site/)
```

### [ ] Set environment variables in Vercel

| Variable | Value | Source |
|----------|-------|--------|
| `DATABASE_URL` | Same as Railway | site-builder-ai config |
| `JWT_SECRET` | Same as Railway | site-builder-ai config |
| `VERCEL_TOKEN` | From Vercel account | For API calls |
| `SENDGRID_API_KEY` | If email needed | Client provides |

### [ ] Configure both main and staging branches for auto-deploy

```
Vercel → Settings → Git → Deploy Hooks
- Main branch → Production deployment
- Staging branch → Preview deployment
```

### [ ] Verify preview URL pattern uses TEAM SLUG

> ⚠️ **CRITICAL LESSON:** Vercel preview URLs use TEAM SLUG not GitHub username.

**Wrong:** `https://project-git-branch-RLooney88.vercel.app`  
**Right:** `https://project-git-branch-rcl-integrated.vercel.app`

```javascript
// Verify in Vercel API response:
{
  "meta": {
    "scope": "rcl-integrated"  // This is the team slug
  }
}
```

### [ ] Force-sync staging to main before testing

```bash
# If staging exists but differs from main:
git checkout staging
git merge main --strategy=ours  # Keep staging's existing structure
git push origin staging
```

**Why:** Ensures there's a clean baseline to start from.

---

## Phase 5: Integration Testing

**Duration:** 15 minutes  
**Owner:** Aster + Roddy  
**Status:** [ ]

### [ ] Test admin login

```
1. Go to /admin/
2. Attempt login with admin credentials
3. Verify JWT token generated
4. Verify redirected to dashboard
```

### [ ] Test each dashboard tab

```
- Dashboard: Loads without errors
- Pages: Lists all static pages
- Posts: Creates and publishes a test post
- Media: Uploads an image successfully
- Settings: Saves changes without error
```

### [ ] Test AI chat editing

```
1. Open AI Chat tab
2. Send: "What pages exist on this site?"
3. Verify: AI responds correctly
4. Send: "Update the homepage title"
5. Verify: Preview branch created
```

### [ ] Test preview workflow

```
1. After AI edit, click preview link
2. Wait 30 seconds for Vercel deploy
3. Verify changes appear on preview URL
4. Confirm design matches original
```

### [ ] Test publish workflow

```
1. On preview, click "Approve" or send "Publish"
2. Verify: Merge to main succeeds
3. Verify: Production URL updates (~30 seconds)
4. Verify: Preview branch deleted
```

### [ ] Test file upload

```
1. Go to Media tab
2. Upload an image
3. Verify: Image appears in gallery
4. Verify: File committed to GitHub
5. Verify: Image renders on site
```

---

## Phase 6: Domain & Go-Live

**Duration:** 10 minutes  
**Owner:** Roddy  
**Status:** [ ]

### [ ] Point domain to Vercel

```
DNS Provider → DNS Records:

Type: CNAME
Name: www (or @)
Value: cname.vercel-dns.com.

Type: A (if apex domain)
Name: @
Value: 76.76.21.21
```

### [ ] Add custom domain in Vercel

```
Vercel → Project → Settings → Domains
- Add: clientdomain.com
- Add: www.clientdomain.com
- Verify SSL certificate provisions automatically
```

### [ ] Verify production site loads

```
1. Clear browser cache
2. Visit https://clientdomain.com
3. Verify: Site loads correctly
4. Verify: All assets (CSS, JS, images) load
5. Verify: Forms and dynamic features work
```

### [ ] Verify SSL certificate

```
1. Visit https://clientdomain.com
2. Check browser lock icon in address bar
3. Verify certificate shows correct domain
4. If no lock, wait 5-10 minutes for provisioning
```

---

## Key Lessons / Time-Savers

**Bookmark this section. These saved hours of debugging.**

### [ ] Always crawl the live site directly

> **We lost hours on stale content** when using backups and FTP dumps. Crawl the live site — it's the only way to get current content.

### [ ] Vercel preview URLs use TEAM SLUG, not GitHub username

**Wrong pattern:** `https://project-git-branch-RLooney88.vercel.app`  
**Correct pattern:** `https://project-git-branch-rcl-integrated.vercel.app`

### [ ] Always run `npm install` locally after adding dependencies

Railway uses `npm ci` which requires `package-lock.json` to be in sync. Never add a dependency without running `npm install` and committing the lockfile.

### [ ] Handle GitHub merge API 204 responses

```javascript
// GitHub merge returns 204 when branches are in sync
const response = await fetch(mergeUrl, { method: 'POST', ... });
if (response.status === 204) {
  return { message: 'Already in sync - no changes to merge' };
}
```

### [ ] Don't commit .env files

GitHub push protection blocks commits with API keys. Use `.gitignore` and set env vars in Railway/Vercel dashboards only.

### [ ] The admin JWT is NOT a Vercel token

Don't use the JWT from admin auth for Vercel API calls. Each has a separate token.

### [ ] Check for duplicate function declarations

When multiple agents edit `server.js`, duplicate function declarations crash Node. Search before adding: `grep -n 'function functionName' server.js`

### [ ] Force-sync staging to main before first testing

Ensure there's a clean baseline to merge against, or the first publish will return "nothing to merge" (204).

### [ ] Use direct GitHub API for binary file uploads

```javascript
// DON'T use updateFile() for binary - it double-encodes base64
// DO use direct GitHub Contents API for images/PDFs
```

### [ ] Railway env vars must be set manually in dashboard

Our API token returns 0 projects. No automation possible — set vars in Railway UI manually.

---

## Post-Onboarding Checklist

- [ ] Add client to PROJECT-STATUS.md "Current Clients" table
- [ ] Store client credentials in `secrets/roddy/` (encrypted)
- [ ] Update index.md if new documentation created
- [ ] Send client their admin URL and credentials
- [ ] Schedule walkthrough call with client
- [ ] Add to memory/YYYY-MM-DD.md with notes

---

## Troubleshooting Quick Reference

| Problem | Solution |
|---------|----------|
| 401 on /chat endpoint | Check ANTHROPIC_API_KEY in Railway |
| 204 on merge | Handle as "already in sync", not error |
| Binary files corrupted | Use direct GitHub API, not updateFile() |
| Vercel preview 404 | Wait 30s for deployment, check team slug |
| Railway npm ci fails | Run `npm install` locally, commit lockfile |
| JWT auth fails on CMS | Verify JWT_SECRET matches on Railway and Vercel |
| Duplicate function errors | Check server.js for existing declarations |
| .env commit blocked | Remove from git, use dashboard only |

---

**Total Estimated Time:** ~3 hours  
**Compared to first client:** Saved ~5+ hours of debugging and retries
