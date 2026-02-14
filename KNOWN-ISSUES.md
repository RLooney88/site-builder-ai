# Known Issues & Gotchas — Site Builder AI

> Lessons learned from the initial build and deployment. Reference this before any new site onboarding or major changes.

---

## Deployment & Infrastructure

### 1. Railway `npm ci` requires synced lockfile
**Problem:** Adding a dependency to `package.json` without running `npm install` locally breaks Railway builds. Railway uses `npm ci` which requires `package-lock.json` to be in sync.  
**Fix:** Always run `npm install <package>` locally and commit both `package.json` AND `package-lock.json`.  
**Frequency:** Every time a new dependency is added.

### 2. Railway env vars must be set manually in dashboard
**Problem:** The Railway API token we have returns 0 projects — can't set env vars programmatically.  
**Fix:** All environment variables (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, etc.) must be set in the Railway web dashboard manually.  
**Impact:** Slows initial setup; easy to forget a variable.

### 3. GitHub push protection blocks .env commits
**Problem:** If `.env` accidentally gets staged, GitHub rejects the push because it detects API keys.  
**Fix:** Ensure `.gitignore` includes `.env` before first commit. Never commit secrets to the repo.

---

## API & Authentication

### 4. Anthropic API key goes stale
**Problem:** The `ANTHROPIC_API_KEY` in Railway was invalid/stale, causing 401 errors on the `/chat` endpoint.  
**Fix:** Verify the key works before deploying. The canonical key lives in `secrets/roddy/anthropic-api-key.json` in the workspace. Update Railway manually when rotated.  
**Symptom:** `401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}`

### 5. GitHub merge API returns 204 when branches are in sync
**Problem:** `POST /repos/:owner/:repo/merges` returns 204 No Content (empty body) when there's nothing to merge. Calling `response.json()` on an empty body throws "Unexpected end of JSON input".  
**Fix:** Check for `response.status === 204` before parsing JSON. Return a friendly "already in sync" response.  
**Symptom:** Publish button returns 500 "Unexpected end of JSON input".

---

## File Uploads

### 6. `updateFile()` double-encodes base64 for binary files
**Problem:** The `updateFile()` helper in `lib/github.js` runs `Buffer.from(content).toString('base64')`. If the content is already base64 (e.g., from `multer`'s buffer), it gets double-encoded and the file is corrupted.  
**Fix:** For binary uploads, call the GitHub Contents API directly instead of using `updateFile()`. The storage abstraction layer at the top of `server.js` does this correctly.  
**Applies to:** Any binary file upload (images, PDFs, etc.)

### 7. Duplicate function declarations crash Node
**Problem:** When multiple contributors (or sub-agents) add code to `server.js`, it's easy to accidentally declare the same function twice. Node ESM throws `SyntaxError: Identifier 'X' has already been declared`.  
**Fix:** Keep storage abstraction functions at the top of the file in a clearly marked section. Check for existing declarations before adding new ones.  
**Prevention:** Search for function name before adding: `grep -n 'function functionName' server.js`

---

## Vercel & Preview Workflow

### 8. Vercel uses team slug, not GitHub username, in URLs
**Problem:** Preview URLs follow the pattern `https://{project}-git-{branch}-{scope}.vercel.app` where `{scope}` is the Vercel team slug (e.g., `rcl-integrated`), NOT the GitHub username (`RLooney88`).  
**Fix:** Store the correct preview URL pattern in the database or derive it from the Vercel API. Don't hardcode GitHub usernames in URL generation.

### 9. Staging/main sync causes "nothing to merge"
**Problem:** If staging is force-pushed to match main (e.g., after a fresh setup), the first publish attempt has nothing to merge and used to 500.  
**Fix:** Handle the 204 response gracefully (see issue #5). This is expected behavior, not an error.

### 10. CORS blocks direct Vercel API calls from browser
**Problem:** The admin dashboard can't call `api.vercel.com` directly due to CORS restrictions.  
**Fix:** Created `/api/admin/deployment-status.js` as a Vercel serverless function that proxies the request. Requires `VERCEL_TOKEN` env var on the Vercel project.

### 11. Deployment polling race condition
**Problem:** After pushing changes, Vercel takes 15-30s to build. If the user clicks "Preview" immediately, they see the old version.  
**Fix:** Deployment progress modal with Vercel API polling. Shows animated stages while polling deployment status, redirects only when `state === 'READY'`.

---

## Admin Dashboard

### 12. No emoji on buttons
**Problem:** Roddy's explicit rule — no robot emoji or cutesy icons on functional UI elements.  
**Fix:** Keep buttons text-only and professional. Humor goes in the deployment modal stage messages, not in permanent UI.

### 13. Development work must push to `main`, not `staging`
**Problem:** Only user edits via the admin dashboard should go to `staging`. Developer work (Aster, sub-agents) pushes directly to `main`.  
**Fix:** Always check which branch you're on before committing. The local repo may be on `staging` from a previous operation. Use `git checkout main` before dev commits.  
**Symptom:** Commits land on staging, `git push origin main` says "up-to-date" because main didn't change.

---

## Database

### 14. New columns need explicit migration
**Problem:** Adding columns to existing tables (e.g., `status` on posts/petitions, `vercel_project_id` on sites) requires running ALTER TABLE manually on the Railway database.  
**Fix:** Create migration scripts in `scripts/` and run them against the Railway DB. Document migrations in commit messages.

### 15. Sessions table may have NULL fields
**Problem:** The `/history` endpoint crashed when sessions had missing/null fields.  
**Fix:** Handle missing sessions gracefully — return empty array instead of crashing.

---

## General Patterns

### 16. Sub-agent code conflicts
**Problem:** When spawning sub-agents to modify `server.js`, they may duplicate existing code or conflict with changes made in the main session.  
**Fix:** Always review sub-agent output before pushing. Check for duplicate function names, import conflicts, and overlapping route handlers.  
**Prevention:** Give sub-agents explicit file boundaries and tell them to read existing code first.

### 17. Cost model for AI chat
**Problem:** Each chat message calls Claude Sonnet 4.5, which is $3/$15 per million tokens. Heavy editing sessions can add up.  
**Future:** Consider Haiku for simple edits, Sonnet for complex ones. Add model routing based on message complexity.

---

*Last updated: 2026-02-14*  
*Add new issues as they're discovered. Reference issue numbers in commit messages.*
