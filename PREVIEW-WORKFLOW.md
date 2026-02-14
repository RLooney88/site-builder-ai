# Preview Workflow

**Status:** ✅ Implemented  
**Date:** 2026-02-13

## Overview

Users can preview AI changes before publishing to production using Vercel's automatic branch deployments.

**One Vercel Project, Multiple Deployments:**
- Main branch → Production: `https://secure-the-vote.vercel.app`
- Preview branches → Automatic previews: `https://secure-the-vote-git-preview-123456.vercel.app`

**No second project needed. No configuration needed.**

## How It Works

### 1. AI Makes Changes

When AI edits files via GitHub:
- Changes are committed to a **preview branch** (not main)
- Branch name: `preview-{timestamp}` (e.g., `preview-1707873600000`)
- Vercel detects new branch and auto-deploys

### 2. User Reviews Preview

- AI returns preview URL
- User clicks and reviews changes on live preview site
- Preview is fully functional (not a screenshot or mockup)

### 3. User Approves or Rejects

**Approve:**
- Preview branch merges to main
- Production site updates automatically
- Preview branch deleted (cleanup)

**Reject:**
- Preview branch stays (for reference)
- User can request more changes
- New preview branch created for next iteration

## API Workflow

### Step 1: AI Edits Files (Handled Automatically)

When AI uses GitHub API to edit files, it:
1. Creates preview branch from main
2. Commits changes to preview branch
3. Returns preview details to user

**No explicit preview endpoint call needed** - it's built into the file editing process.

### Step 2: Manual Preview Trigger (Optional)

If user wants preview of current state:

```bash
POST /sites/securethevotemd/preview

Response:
{
  "previewUrl": "https://secure-the-vote-git-preview-1707873600.vercel.app",
  "branch": "preview-1707873600000",
  "message": "Preview branch created. Vercel will deploy in ~30 seconds."
}
```

### Step 3: Approve Changes

```bash
POST /sites/securethevotemd/approve
{
  "previewBranch": "preview-1707873600000"
}

Response:
{
  "status": "approved",
  "message": "Changes merged to production. Live in ~30 seconds.",
  "productionUrl": "https://secure-the-vote.vercel.app"
}
```

## User Experience

### Chat Interface Example

```
User: "Change the homepage title to 'Secure Your Vote 2026'"

AI: "I'll update the homepage title for you.

Editing: src/index.njk
Creating preview branch: preview-1707873600000

✅ Changes made!
🔗 Preview: https://secure-the-vote-git-preview-1707873600000.vercel.app

The preview will be ready in about 30 seconds. Review it and let me know:
- 'Approve' to publish to production
- Request changes if you want adjustments"

---

User: "Approve"

AI: "✅ Changes approved and merged to production!

Your live site will update in ~30 seconds:
https://secure-the-vote.vercel.app

The preview branch has been cleaned up."
```

## Technical Details

### GitHub API Operations

**Create Preview Branch:**
```javascript
// 1. Get main branch SHA
GET /repos/RLooney88/Secure-the-Vote/git/refs/heads/main

// 2. Create new branch
POST /repos/RLooney88/Secure-the-Vote/git/refs
{
  "ref": "refs/heads/preview-1707873600000",
  "sha": "<main-sha>"
}
```

**Commit Changes to Preview:**
```javascript
PUT /repos/RLooney88/Secure-the-Vote/contents/src/index.njk
{
  "message": "AI: Update homepage title",
  "content": "<base64-content>",
  "branch": "preview-1707873600000"
}
```

**Merge to Main:**
```javascript
POST /repos/RLooney88/Secure-the-Vote/merges
{
  "base": "main",
  "head": "preview-1707873600000",
  "commit_message": "Approve AI changes from preview-1707873600000"
}
```

**Clean Up:**
```javascript
DELETE /repos/RLooney88/Secure-the-Vote/git/refs/heads/preview-1707873600000
```

### Vercel Auto-Deploy

**When new branch is pushed:**
1. Vercel webhook triggers
2. Vercel builds from preview branch
3. Deployment completes (~30 seconds)
4. Preview URL is live

**Preview URL Pattern:**
```
https://{project-name}-git-{branch-name}.vercel.app
```

**Example:**
```
Project: Secure-the-Vote
Branch: preview-1707873600000
URL: https://secure-the-vote-git-preview-1707873600000.vercel.app
```

### Database Tracking

**edits table records each preview:**
```sql
CREATE TABLE edits (
  id SERIAL PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id),
  file_path TEXT NOT NULL,
  change_description TEXT,
  preview_url TEXT,          -- Vercel preview URL
  preview_branch TEXT,        -- Git branch name
  approved BOOLEAN DEFAULT FALSE,
  deployed_at TIMESTAMPTZ,    -- When merged to production
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Query preview history:**
```sql
SELECT 
  preview_branch,
  preview_url,
  approved,
  deployed_at,
  created_at
FROM edits
WHERE session_id = 'securethevotemd-1707873600000'
ORDER BY created_at DESC;
```

## Benefits

### For Users
- ✅ See exact changes before going live
- ✅ Test functionality on real preview site
- ✅ Iterate safely without affecting production
- ✅ Roll back by simply not approving

### For Developers
- ✅ No additional infrastructure (Vercel built-in)
- ✅ Automatic cleanup after merge
- ✅ Full audit trail in database
- ✅ Works with existing Git workflow

## Edge Cases

### Multiple Previews in Progress

**Scenario:** User requests changes before approving previous preview

**Behavior:**
- New preview branch created: `preview-1707873700000`
- Both previews exist simultaneously
- User can compare both URLs
- Approve whichever they prefer

**Database:**
```sql
-- Both recorded
preview_branch: preview-1707873600000, approved: false
preview_branch: preview-1707873700000, approved: false

-- User approves second one
preview_branch: preview-1707873700000, approved: true, deployed_at: NOW()
```

### Vercel Deployment Failure

**Scenario:** Preview branch has build error

**Behavior:**
- Vercel deployment fails
- Preview URL shows error page
- User sees build log in Vercel
- AI can help fix the error

**Mitigation:**
- AI should validate syntax before committing
- Build errors caught during preview (not production)

### Network Timing

**Scenario:** User clicks preview URL before Vercel finishes deploying

**Behavior:**
- URL shows "404 - Deployment Not Found"
- After 30 seconds, deployment completes
- Refresh shows preview

**AI Response:**
```
"Preview URL: https://...
(Vercel is deploying now - give it 30 seconds then refresh)"
```

## Testing

### Test Preview Creation

```bash
curl -X POST http://localhost:3000/sites/securethevotemd/preview \
  -H "Content-Type: application/json" \
  -d '{"files": ["src/index.njk"]}'
```

**Expected:**
```json
{
  "previewUrl": "https://secure-the-vote-git-preview-1707873600000.vercel.app",
  "branch": "preview-1707873600000",
  "message": "Preview branch created. Vercel will deploy in ~30 seconds."
}
```

**Verify:**
1. Check GitHub: branch `preview-1707873600000` exists
2. Check Vercel: deployment in progress
3. Wait 30 seconds
4. Visit preview URL: site loads

### Test Approval

```bash
curl -X POST http://localhost:3000/sites/securethevotemd/approve \
  -H "Content-Type: application/json" \
  -d '{"previewBranch": "preview-1707873600000"}'
```

**Expected:**
```json
{
  "status": "approved",
  "message": "Changes merged to production. Live in ~30 seconds.",
  "productionUrl": "https://secure-the-vote.vercel.app"
}
```

**Verify:**
1. Check GitHub: changes merged to main
2. Check GitHub: preview branch deleted
3. Check Vercel: production deployment triggered
4. Check database: `approved = true, deployed_at = NOW()`

---

**Implementation Time:** ~20 minutes  
**Complexity:** Low (Vercel handles heavy lifting)  
**Dependencies:** GitHub API, Vercel auto-deploy (already configured)  
**Status:** ✅ Ready for testing
