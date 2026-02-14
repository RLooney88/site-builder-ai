# Site Builder AI - Deployment Checklist

**Date:** 2026-02-13  
**Status:** Code complete, pending environment variables

## ✅ Completed

- [x] Express API server created and tested
- [x] PostgreSQL database provisioned on Railway
- [x] Database schema created (sites, sessions, messages, edits)
- [x] SecureTheVoteMD site registered in database
- [x] Site config updated with CMS integration
- [x] Claude API key configured in Railway
- [x] GitHub token configured in Railway
- [x] CMS API integration implemented
- [x] JWT authentication added
- [x] Smart routing (CMS vs GitHub) implemented
- [x] Code committed to GitHub
- [x] Code pushed to origin/master
- [x] Comprehensive documentation written

## ⚠️ Pending - Manual Steps Required

### 1. Add DATABASE_URL to Railway

**Where:** Railway dashboard → site-builder-ai project → site-builder-ai service → Variables

**Variable:**
```
Name: DATABASE_URL
Value: postgresql://postgres:jpMUheDiuKdrdvCtlNqARXRiCdeOhZXI@caboose.proxy.rlwy.net:48174/railway
```

**Why:** Service needs database connection to store chat history and site configs

---

### 2. Add JWT_SECRET to Railway

**Where:** Railway dashboard → site-builder-ai project → site-builder-ai service → Variables

**Variable:**
```
Name: JWT_SECRET
Value: STVmd2026-jwt-secret-key
```

**Why:** AI needs this to generate JWT tokens for CMS API authentication

**CRITICAL:** This MUST match the JWT_SECRET in SecureTheVoteMD's Vercel environment

---

### 3. Verify Automatic Redeploy

After adding environment variables:

- [ ] Railway triggers automatic redeploy (watch dashboard)
- [ ] Deployment succeeds (check logs for errors)
- [ ] Service shows "Online" status
- [ ] Health endpoint responds: `https://site-builder-ai-production.up.railway.app/health`

---

### 4. Install Dependencies on Railway

Railway should automatically run `npm install` and pick up the new `jsonwebtoken` dependency.

**Verify in deployment logs:**
```
added 1 package, and audited X packages in Xs
```

If not, the deploy will fail with:
```
Error: Cannot find module 'jsonwebtoken'
```

---

## 🧪 Testing After Deployment

### Test 1: Health Check

```bash
curl https://site-builder-ai-production.up.railway.app/health
```

**Expected:**
```json
{
  "status": "ok",
  "timestamp": "2026-02-13T..."
}
```

---

### Test 2: Blog Post Creation via AI

```bash
curl -X POST https://site-builder-ai-production.up.railway.app/sites/securethevotemd/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Create a blog post titled \"Test Post from AI\" with content \"This is a test of the CMS integration\" in the news category"
  }'
```

**Expected:**
```json
{
  "message": "✅ Blog post created and published...",
  "sessionId": "securethevotemd-..."
}
```

**Verify:**
- Check CMS database: `SELECT * FROM posts WHERE title = 'Test Post from AI'`
- Check generated HTML exists: `https://secure-the-vote.vercel.app/2026/02/13/test-post-from-ai/`

---

### Test 3: Static Page Edit Request

```bash
curl -X POST https://site-builder-ai-production.up.railway.app/sites/securethevotemd/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What files would I need to edit to change the homepage hero text?"
  }'
```

**Expected:**
AI responds with:
- File path: `src/index.njk`
- Explanation of how to edit it
- Offer to make the change via GitHub

---

### Test 4: JWT Token Validation

After blog post creation, check that:

1. AI generated a JWT token
2. Token was accepted by CMS API
3. Blog post was created with `created_by` or similar tracking

**Check Railway logs:**
```
✅ JWT token generated
✅ Calling CMS API: POST /api/admin/posts
✅ Response: 200 OK
```

---

## 🚨 Troubleshooting

### "Cannot find module 'jsonwebtoken'"

**Cause:** npm install didn't run or failed

**Fix:**
1. Check Railway deployment logs
2. Manually trigger redeploy if needed
3. Verify package.json includes `"jsonwebtoken": "^9.0.2"`

---

### "Unauthorized" when AI calls CMS API

**Cause:** JWT_SECRET mismatch or missing

**Fix:**
1. Verify Railway has `JWT_SECRET` env var
2. Verify Vercel (SecureTheVote) has same `JWT_SECRET`
3. Redeploy both services
4. Check Railway logs for JWT generation

---

### "Cannot connect to database"

**Cause:** DATABASE_URL not set or incorrect

**Fix:**
1. Verify Railway has `DATABASE_URL` env var
2. Check connection string format
3. Test connection manually: `psql postgresql://postgres:jpMU...`

---

### AI edits blog HTML files instead of using CMS

**Cause:** System prompt not loaded from database

**Fix:**
1. Check site config: `SELECT config FROM sites WHERE id = 'securethevotemd'`
2. Verify `config.systemPrompt` includes CMS routing rules
3. Redeploy if needed

---

## 📋 Post-Deployment Checklist

After successful deployment:

- [ ] Health endpoint responds
- [ ] Database connection works
- [ ] JWT token generation works
- [ ] Blog post creation via AI works
- [ ] Static page edit routing works
- [ ] No errors in Railway logs
- [ ] Update PROJECT-STATUS.md with deployment timestamp
- [ ] Document any issues encountered
- [ ] Update memory/2026-02-13.md with final status

---

## 🎯 Next Steps After Deployment

1. **Build chat UI** for SecureTheVoteMD admin dashboard
   - Simple chat interface
   - Connect to Site Builder AI API
   - Display AI responses with formatting

2. **Test with real use cases**
   - Client adds a blog post via AI
   - Client updates homepage via AI
   - Client edits banner via AI

3. **User acceptance testing**
   - Train client on how to use AI chat
   - Gather feedback
   - Iterate on system prompt

4. **Production monitoring**
   - Set up error tracking
   - Monitor API usage
   - Track token costs

---

**Time Estimate:** 5-10 minutes for manual env var configuration  
**Risk Level:** Low (non-breaking changes, backwards compatible)  
**Rollback Plan:** Remove new env vars, redeploy previous commit
