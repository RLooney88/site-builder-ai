# Themis Marketing Website

Professional marketing/landing page for **Themis** — an AI-powered website builder for small business owners.

## 🎯 Purpose

This is the public-facing marketing site served at `buildwiththemis.com`. It explains the product, addresses pain points, and converts visitors into customers.

## 📁 Structure

```
marketing/
├── index.html          # Main landing page (all sections)
├── css/
│   └── style.css       # Complete styles with Athena palette
├── js/
│   └── main.js         # Smooth scroll, mobile nav, animations
├── images/
│   └── .gitkeep        # Placeholder for future assets
└── README.md           # This file
```

## 🎨 Brand Guidelines

**Colors (Athena Palette):**
- Primary Purple: `#9834E7`
- Pink Accent: `#E8479D`
- Gradient: `linear-gradient(135deg, #9834E7, #E8479D)`
- Dark sections: `#0B1220`, `#171129`
- Light sections: `#FFFFFF`, `#F8F9FA`
- Text: `#1a1a2e` on light, `#FFFFFF` on dark

**Typography:**
- Font: Inter (Google Fonts)
- Tone: Professional but approachable
- Language: Speak to business owners, not developers

**Tagline Options:**
- "Your AI web team"
- "Edit your website by just asking"
- "The website builder that actually listens"

## 📄 Page Sections

1. **Hero** — Big promise, clear CTA, mockup of dashboard
2. **Pain Points** — Empathetic "Sound familiar?" addressing frustrations
3. **How It Works** — 3 simple steps
4. **Features** — 6 key capabilities (AI editing, preview, uploads, etc.)
5. **Use Cases** — Real-world examples in quotes
6. **Pricing** — 3 tiers (Starter, Professional, Agency) — placeholder prices
7. **FAQ** — 5 common questions answered
8. **Footer** — Links, contact, copyright

## 🚀 Deployment

This is a **static site** — no build step required.

### Local Testing

Simply open `index.html` in a browser, or use a local server:

```bash
# Python
python -m http.server 8000

# Node.js
npx serve .

# VS Code Live Server extension
# Right-click index.html → "Open with Live Server"
```

Visit `http://localhost:8000` (or whatever port).

### Production Hosting

Upload to any static host:
- **Netlify:** Drag & drop the `marketing/` folder
- **Vercel:** `vercel --prod`
- **GitHub Pages:** Push to `gh-pages` branch
- **S3 + CloudFront:** `aws s3 sync . s3://your-bucket`
- **Traditional hosting:** FTP to `public_html/`

### DNS

Point `buildwiththemis.com` to your hosting provider:
- A record → hosting IP
- CNAME → hosting domain (e.g., `netlify.app`)

## ✨ Features

- **Mobile Responsive** — Works on all devices
- **Smooth Scroll** — Anchor links animate smoothly
- **Sticky Navigation** — Nav bar follows as you scroll
- **Fade-in Animations** — Sections animate as they enter viewport
- **Mobile Menu** — Hamburger menu for small screens
- **Performance** — Minimal dependencies, fast load times
- **SEO-Friendly** — Semantic HTML, meta tags, proper headings

## 🔧 Customization

### Change Colors

Edit CSS variables in `css/style.css`:

```css
:root {
    --primary-purple: #9834E7;
    --pink-accent: #E8479D;
    /* ... */
}
```

### Update Content

Edit `index.html` directly. All content is in plain HTML.

### Add Images

1. Place images in `images/` folder
2. Reference in HTML: `<img src="images/your-image.jpg" alt="Description">`
3. For hero mockup, replace `.mockup-window` content with actual screenshot

### Change Pricing

Update the `.pricing-card` sections in `index.html`. Prices are placeholders.

### Add Analytics

Insert tracking code in `<head>` of `index.html`:

```html
<!-- Google Analytics -->
<script async src="https://www.googletagmanager.com/gtag/js?id=GA_TRACKING_ID"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'GA_TRACKING_ID');
</script>
```

## 🎯 Target Audience

**Small business owners** who:
- Have a website but can't afford a developer for every change
- Want to update their own site without learning code
- Need a professional web presence without technical skills
- Are frustrated with WordPress complexity and plugin hell

## 📝 Notes

- **No emoji on buttons** (per design requirements)
- **Professional typography** (Inter font)
- **NO frameworks** (vanilla HTML/CSS/JS)
- **NO build tools** (ready to deploy as-is)
- **Pricing is placeholder** — adjust before launch

## 🔗 Links

- **Live site:** `https://buildwiththemis.com` (when deployed)
- **App login:** `https://app.buildwiththemis.com`
- **Contact:** `hello@buildwiththemis.com` (placeholder)

## 🏢 Credits

Built for **Themis** by **Pantheon Technologies**

Copyright © 2026 Themis. All rights reserved.

---

**Status:** ✅ Ready to deploy

**Last updated:** 2026-02-14
