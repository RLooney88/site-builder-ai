# Themis — Universal Admin Dashboard

A standalone frontend for managing sites built with Site Builder AI.

## What is Themis?

Themis is a universal admin dashboard that works with ANY site managed by the Site Builder AI backend. It extracts and improves the admin functionality that was previously embedded in individual site repos.

## Features

- **AI Chat Interface** — Natural language site editing with live SSE streaming
- **Content Management** — Posts, petitions, and banner settings
- **Preview & Publish** — Deploy to staging or production with real-time progress
- **File Uploads** — Drag-drop image uploads with thumbnail previews
- **Multi-Site Support** — Manage multiple sites from one dashboard
- **Athena Branding** — Beautiful purple-pink gradient theme

## Architecture

- **Static HTML/CSS/JS** — No build step required
- **Site-agnostic** — Takes `siteId` as URL parameter (`?site=securethevotemd`)
- **Modular Design** — Separated into logical JS modules:
  - `app.js` — Main app logic, auth, routing
  - `chat.js` — AI chat interface with SSE streaming
  - `content.js` — Posts, petitions, and banner management
  - `deploy.js` — Deployment modal with Vercel polling
  - `upload.js` — File upload handling

## Setup

1. **Configure Backend URL**  
   Edit `js/app.js` to set your backend URL:
   ```javascript
   window.THEMIS_CONFIG = {
     apiBase: 'https://your-backend-url.com'
   };
   ```

2. **Serve as Static Files**  
   Themis can be served from any static hosting (Vercel, Netlify, S3, etc.)

3. **Access with Site ID**  
   Navigate to `https://themis.yourdomain.com/?site=your-site-id`

## API Endpoints (Backend)

Themis expects these endpoints on the backend:

### Authentication
- `POST /auth/login` — Login with email/password → JWT token

### Sites
- `GET /sites` — List all sites
- `GET /sites/:siteId` — Get site details
- `GET /sites/:siteId/pages` — List pages in repo

### AI Chat
- `POST /sites/:siteId/chat?stream=true` — AI chat with SSE streaming
- `GET /sites/:siteId/history` — Chat history

### Uploads
- `POST /sites/:siteId/upload` — Upload file (multipart)
- `GET /sites/:siteId/uploads` — List uploaded files

### Deployments
- `POST /sites/:siteId/preview` — Deploy to staging
- `POST /sites/:siteId/publish` — Merge to production

### CMS (proxied through backend)
- `GET /sites/:siteId/cms/posts`
- `POST /sites/:siteId/cms/posts/create`
- `POST /sites/:siteId/cms/posts/:id/delete`
- `GET /sites/:siteId/cms/petitions`
- `POST /sites/:siteId/cms/petitions/create`
- `POST /sites/:siteId/cms/petitions/:id/delete`
- `GET /sites/:siteId/cms/banner-settings`
- `POST /sites/:siteId/cms/banner-settings`

## Athena Branding Colors

```css
--primary-purple: #9834E7
--pink-accent: #E8479D
--gradient-primary: linear-gradient(135deg, #9834E7, #E8479D)
--dark-bg: #0B1220
--card-bg: #171129
--secondary-panel: #1E1637
--hover-active: #2B2150
--border-accent: #C03DC2
--success-green: #27AE60
--error-red: #E24848
```

## Design Notes

- **NO emoji on buttons** — Clean, professional UI
- **Dark theme throughout** — Athena-style branding
- **Responsive** — Works on mobile devices
- **Tabs across top** — AI Editor, Posts, Petitions, Banner
- **Preview/Publish always visible** — Header buttons for quick deployment

## Version

**1.0.0** — Initial release

## License

Proprietary — Site Builder AI
