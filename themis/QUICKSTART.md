# Themis Quick Start Guide

## Running Locally

1. **Start the backend server** (in `repos/site-builder-ai/`):
   ```bash
   npm start
   ```

2. **Serve Themis** (from `repos/site-builder-ai/themis/`):
   ```bash
   # Using Python 3
   python -m http.server 8080
   
   # Or using Node.js (install http-server globally first)
   npx http-server -p 8080
   ```

3. **Open in browser**:
   ```
   http://localhost:8080/?site=securethevotemd
   ```

## First Login

Use the admin credentials from your Site Builder AI backend:
- Email: (your admin email)
- Password: (your admin password)

## Usage

### AI Editor Tab
- Type natural language requests to edit your site
- Attach images via paperclip button, drag-drop, or paste from clipboard
- Upload button for permanent media files
- Preview/Publish buttons in header to deploy changes

### Posts Tab
- Create, edit, and delete blog posts
- Save as draft or publish immediately
- Search and filter posts by status

### Petitions Tab
- Create and manage petitions
- Track signatures
- Toggle active/inactive status

### Banner Settings Tab
- Update homepage banner text and link
- Enable/disable banner display

## Deployment

Themis is a static site — deploy to:
- **Vercel**: `vercel --prod`
- **Netlify**: Drag folder to Netlify dashboard
- **S3**: Upload to bucket and enable static hosting
- **Any static host**: Just upload the files

## Configuration

Edit `js/app.js` to change the backend URL:

```javascript
window.THEMIS_CONFIG = {
  apiBase: 'https://your-backend-production-url.com',
  appName: 'Themis',
  version: '1.0.0'
};
```

## Troubleshooting

**Login fails**: Check backend URL in `js/app.js`  
**No sites shown**: Verify `/sites` endpoint returns data  
**Chat doesn't work**: Check site ID in URL parameter  
**Images won't upload**: Verify `/sites/:siteId/upload` endpoint  
**Preview/Publish fails**: Check deployment endpoints

## Support

See `README.md` for full API documentation and architecture details.
