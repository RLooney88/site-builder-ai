# Site Builder AI (Themis) — Architecture Review & Recommendations

**Author:** Aster (OpenClaw AI)  
**Date:** 2026-02-15  
**Purpose:** Comprehensive architectural analysis and recommendations to fix the header/footer consistency problem and improve overall system design.

---

## Executive Summary

Site Builder AI (Themis) is an AI-powered website management tool that allows non-technical users to edit websites through a chat interface. The system works by giving Claude AI access to a website's GitHub repository with tools to read and write files.

**Core Problem:** The system cannot reliably maintain headers and footers — the most standardized parts of any website. This is a fundamental architectural issue, not a bug.

**Root Cause:** The system treats templates as something to be extracted from HTML files using regex patterns, rather than as first-class entities in the data model.

**Solution:** Implement a template-first architecture where headers, footers, and layout components are stored as reusable database entities, not extracted on-the-fly from HTML.

**Impact:** Without this fix, every page edit risks breaking navigation, styling, or site-wide elements. This erodes user trust and makes the tool unreliable for production use.

---

## Section 1: What an Ideal AI Website Builder Looks Like

An ideal AI-powered website builder should be **invisible infrastructure** — it should "just work" without the user needing to understand repositories, branches, or HTML structure. Here's what that requires architecturally:

### 1.1 Site Understanding Layer

The AI needs a **structured mental model** of each website, not just a collection of files. This model should include:

**Site Anatomy Database:**
```javascript
{
  site_id: "stvm",
  structure: {
    template: "elementor-exported",  // or "eleventy", "hugo", "custom"
    build_system: null,  // or "eleventy", "vite", etc.
    dist_folder: "dist",
    source_folder: null
  },
  components: {
    header: { template_id: "header-1", last_modified: "2024-01-15" },
    footer: { template_id: "footer-1", last_modified: "2024-01-15" },
    navigation: { template_id: "nav-main", last_modified: "2024-01-10" }
  },
  layouts: [
    { id: "page-default", name: "Default Page", usage_count: 12 },
    { id: "page-petition", name: "Petition Page", usage_count: 1 },
    { id: "page-blog", name: "Blog Post", usage_count: 5 }
  ],
  design_tokens: {
    colors: { /* CSS variables or hex values */ },
    typography: { /* font stacks, sizes */ },
    spacing: { /* margin/padding patterns */ }
  },
  pages: [
    { path: "dist/index.html", layout: "page-default", title: "Home" },
    { path: "dist/petition/index.html", layout: "page-petition", title: "Sign the Petition" }
  ]
}
```

This is stored in the database, not inferred on every request. The AI loads this context once and uses it to make informed decisions.

**Why this matters:**
- The AI knows what template to use for new pages
- It knows which components are shared across all pages
- It can detect when changes affect site-wide elements
- It can warn before breaking changes

### 1.2 Template System (The Core Fix)

Templates should be **first-class database entities**, not patterns extracted from HTML.

**Database Schema:**
```sql
CREATE TABLE templates (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id),
  type VARCHAR(50),  -- 'header', 'footer', 'navigation', 'layout'
  name VARCHAR(255),  -- Human-readable name
  content TEXT,  -- The actual HTML/template code
  variables JSONB,  -- Editable fields: {title: 'string', logo_url: 'string'}
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);

CREATE TABLE page_templates (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id),
  name VARCHAR(255),  -- "Default Page", "Petition Page", etc.
  header_template_id UUID REFERENCES templates(id),
  footer_template_id UUID REFERENCES templates(id),
  content_section TEXT,  -- Placeholder HTML showing where content goes
  created_at TIMESTAMP
);

CREATE TABLE pages (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id),
  path VARCHAR(500),  -- dist/petition/index.html
  template_id UUID REFERENCES page_templates(id),
  content TEXT,  -- Just the main content, NOT the full page
  metadata JSONB,  -- {title, description, etc.}
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

**How It Works:**

1. **Site Onboarding:**
   - AI analyzes 3-5 representative pages from the site
   - Identifies common header/footer/navigation patterns
   - Generates canonical templates and stores them in the database
   - Creates layout templates for different page types
   - Maps existing pages to templates

2. **Page Creation:**
   - User: "Create a new 'About Us' page"
   - AI: Selects `page-default` template
   - AI: Generates content HTML for main section
   - System: Assembles final page = `header + content + footer`
   - System: Stores ONLY the content section in `pages.content`
   - System: Writes full assembled page to GitHub

3. **Page Editing:**
   - AI: Reads `pages.content` (just the main section, not full HTML)
   - AI: Edits the content
   - System: Re-assembles full page from template + new content
   - System: Writes to GitHub

4. **Header/Footer Editing:**
   - User: "Add a 'Donate' button to the navigation"
   - AI: Reads `templates` table for navigation template
   - AI: Edits the template content
   - System: Updates `templates.content`
   - System: **Regenerates ALL pages that use this template**
   - System: Commits all updated pages to GitHub in one operation

**Key Benefits:**
- **Headers/footers are never extracted** — they're stored once and reused
- **Edit once, update everywhere** — changing the header updates all pages
- **No regex fragility** — templates are explicit, not inferred
- **Content is portable** — page content is stored separately from layout
- **Faster AI processing** — AI only reads/edits the content section, not 100KB files

### 1.3 Content Editing

Content editing should operate on **content sections**, not full HTML files.

**Current Problem:**
```
User: "Make the headline bigger"
→ AI reads 100KB HTML file (full page with inline CSS)
→ AI tries to find the headline in the noise
→ AI rewrites the entire file
→ Risk of breaking header/footer/CSS in the process
```

**Ideal Flow:**
```
User: "Make the headline bigger"
→ AI reads pages.content (just 2KB of main content HTML)
→ AI finds <h1> tag, changes class or adds style
→ System re-assembles full page from template + updated content
→ Zero risk to header/footer
```

**Implementation:**
- `read_file` tool returns `pages.content`, not the full HTML
- `write_file` tool updates `pages.content` and triggers page assembly
- AI never sees the full assembled page unless explicitly requested for debugging

### 1.4 Design System

Brand consistency should be enforced through **CSS variables and design tokens**, not by injecting a prose description into the system prompt.

**Current Problem:**
```javascript
// Scans CSS with regex
const colors = cssContent.match(/#[0-9a-fA-F]{6}/g);
// Stores in database: {primary: '#123456', secondary: '#abcdef'}
// Injects into 3000-word system prompt
```

**Problems:**
- Misses CSS variables (`--primary-color`)
- Misses SCSS/preprocessor variables
- Doesn't understand color usage context (primary vs. accent vs. background)
- AI has to remember colors from prose text

**Ideal Approach:**

1. **Extract Design Tokens at Onboarding:**
   ```javascript
   // Parse CSS for variables
   const tokens = extractDesignTokens(cssFiles);
   // {
   //   colors: {
   //     primary: { value: '#1a4d8f', usage: 'buttons, links' },
   //     secondary: { value: '#e8f1f8', usage: 'backgrounds' },
   //     text: { value: '#333', usage: 'body text' }
   //   },
   //   typography: {
   //     heading: 'Montserrat, sans-serif',
   //     body: 'Open Sans, sans-serif',
   //     sizes: {h1: '2.5rem', h2: '2rem', body: '1rem'}
   //   },
   //   spacing: {
   //     small: '0.5rem', medium: '1rem', large: '2rem'
   //   }
   // }
   ```

2. **Store as Structured Data:**
   - Database column: `sites.design_tokens` (JSONB)
   - Includes CSS variable names, hex values, usage context

3. **Provide to AI as Tool, Not Prose:**
   ```javascript
   tools.push({
     name: "get_design_tokens",
     description: "Get the site's design system (colors, fonts, spacing)",
     input_schema: { type: "object", properties: {} }
   });
   ```
   
   AI calls tool when needed, gets structured JSON, applies it.

4. **Validate on Edits:**
   - After AI generates HTML, system scans for color values
   - If non-standard color found, warn/reject/auto-correct
   - Ensures brand consistency without AI having to remember

**Token Efficiency:**
- Removes ~500 words from system prompt
- AI loads design system only when actively editing styles
- Structured JSON is easier for AI to parse than prose

### 1.5 File Management

File operations should be **lazy and differential**, not "read entire file, write entire file."

**Current Problem:**
- Reading `dist/index.html` (100KB) loads 300 lines, truncates the rest
- AI doesn't see the footer (line 500+)
- Writing sends entire 100KB file back to GitHub

**Ideal Approach:**

1. **Content-Only Reads:**
   - `read_file` returns `pages.content` from database (2-5KB)
   - Full HTML assembly happens server-side, not in AI context

2. **Section-Based Reads (for templates):**
   ```javascript
   // AI needs to edit header
   const header = await getTemplate('header-1');
   // Returns just the header HTML, not a full page
   ```

3. **Differential Writes:**
   - AI edits content section
   - Server assembles full page from template + content
   - GitHub write sends only the final assembled HTML (no re-reading needed)

4. **Batch Operations:**
   - When template changes affect multiple pages, queue all regenerations
   - Write to GitHub as a single commit with multiple files
   - Reduces API calls and commit noise

**Token Savings:**
- Current: 100KB file → ~25,000 tokens input per edit
- Ideal: 2KB content → ~500 tokens input per edit
- **50x reduction in token usage**

### 1.6 New Site Creation

Creating a new site from scratch should scaffold from **canonical templates**, not copy from an existing site.

**Ideal Flow:**

1. **User Input:**
   - Site name, domain, primary purpose (blog, petition, business, etc.)
   - Design preferences (modern, classic, minimal, etc.)
   - Color scheme (provide 2-3 colors or choose from presets)

2. **Template Selection:**
   - System has 5-10 pre-built site templates in database
   - Each template has: header, footer, nav, 3-5 page layouts
   - User picks closest match or uses default

3. **Scaffolding:**
   ```javascript
   // Clone template in database
   const newSite = await cloneTemplate('modern-nonprofit', {
     name: 'SecureTheVote MD',
     domain: 'securethevote.org',
     colors: {primary: '#1a4d8f', secondary: '#e8f1f8'}
   });
   
   // Generate initial pages
   await createPage(newSite, 'home', homeContent);
   await createPage(newSite, 'about', aboutContent);
   await createPage(newSite, 'contact', contactContent);
   
   // Create GitHub repo, Vercel project
   await provisionInfrastructure(newSite);
   
   // Assemble and deploy all pages
   await deployInitialSite(newSite);
   ```

4. **AI Customization:**
   - User chats with AI to customize content
   - AI works within established templates from the start
   - No "extract header/footer from example page" needed

**Why This Matters:**
- New sites start with clean, well-structured templates
- No dependency on fragile HTML scraping
- Consistent architecture across all client sites

### 1.7 Existing Site Import

Importing an existing website should be a **one-time analysis and template generation** process.

**Ideal Workflow:**

1. **Site Upload:**
   - User uploads ZIP of HTML files or provides GitHub repo
   - System scans all HTML files

2. **Structure Analysis:**
   ```javascript
   const analysis = await analyzeSiteStructure(files);
   // {
   //   type: 'wordpress-elementor',
   //   confidence: 0.95,
   //   pages: 15,
   //   common_header: '<header>...</header>',  // Found in 100% of pages
   //   common_footer: '<footer>...</footer>',  // Found in 100% of pages
   //   variants: [
   //     { pattern: 'page-default', count: 10, example: 'index.html' },
   //     { pattern: 'page-petition', count: 2, example: 'petition/index.html' }
   //   ]
   // }
   ```

3. **Template Generation:**
   ```javascript
   // Extract canonical templates
   const header = extractCanonicalHeader(analysis.pages);
   const footer = extractCanonicalFooter(analysis.pages);
   
   // Store in database
   await createTemplate(siteId, 'header', header);
   await createTemplate(siteId, 'footer', footer);
   
   // Generate page layouts for each variant
   for (const variant of analysis.variants) {
     const layout = await generateLayout(variant);
     await createPageTemplate(siteId, variant.pattern, layout);
   }
   ```

4. **Content Extraction:**
   ```javascript
   // For each page, extract just the main content
   for (const page of analysis.pages) {
     const content = extractMainContent(page, header, footer);
     await createPage(siteId, page.path, content, page.template);
   }
   ```

5. **Manual Review:**
   - Show user the generated templates
   - Let them edit header/footer/nav if extraction wasn't perfect
   - Once confirmed, all pages use these templates going forward

**Key Principle:**
- Template extraction happens ONCE during import
- After that, templates are explicit entities, never re-extracted
- If extraction fails for some pages, AI helps user fix the template manually

### 1.8 Quality Assurance

QA should be **automated and continuous**, not something the user has to check manually.

**Automated Checks:**

1. **Pre-Commit Validation:**
   ```javascript
   // Before writing to GitHub
   const newHTML = assemblePage(template, content);
   const checks = [
     validateHTML(newHTML),           // W3C validation
     checkBrokenLinks(newHTML),        // Internal link checker
     verifyTemplate(newHTML, template), // Ensure template wasn't corrupted
     checkAccessibility(newHTML)       // Basic a11y checks
   ];
   if (checks.some(c => c.failed)) {
     throw new Error('QA failed: ' + checks.filter(c => c.failed).map(c => c.error).join(', '));
   }
   ```

2. **Visual Regression Testing:**
   - After template changes, screenshot all affected pages
   - Store before/after screenshots
   - Flag pages with significant visual differences for user review

3. **Link Validation:**
   - Run link checker on every deploy
   - Report broken links in admin dashboard
   - AI tool to fix broken links in bulk

4. **Design Token Compliance:**
   - Scan generated HTML for hardcoded colors/fonts
   - Flag violations of design system
   - Suggest corrections

**Continuous Monitoring:**
- Daily link check across all sites
- Weekly design token audit
- Alert to admin dashboard if issues found

---

## Section 2: Current State Assessment

### 2.1 What Works

**1. Chat-First Interface:**
The chat interface is excellent for non-technical users. Editing via conversation is far more accessible than using a CMS admin panel.

**2. Claude Tool Integration:**
The tool system (read_file, write_file, etc.) is well-designed. Claude effectively uses tools to perform file operations.

**3. GitHub + Vercel Workflow:**
The staging → preview → publish workflow is solid. Users can safely preview changes before going live.

**4. Dual Content System:**
The separation between CMS-managed content (blog posts, petitions) and static files is architecturally sound.

**5. Brand Guide Concept:**
Storing brand information in the database is the right idea (even if the execution needs improvement).

### 2.2 What's Broken

**1. Header/Footer Extraction (CRITICAL):**

**The Problem:**
```javascript
function extractHeaderFooter(content) {
  // Tries to find <main>, role="main", id="main", etc.
  const headerPatterns = ['<main', 'role="main"', 'id="main"', ...];
  for (const p of headerPatterns) {
    const idx = content.indexOf(p);
    if (idx !== -1) {
      headerEnd = content.lastIndexOf('\n', idx) + 1;
      break;
    }
  }
  // Falls back to </nav>, </header> tags
  // Caches result in database
}
```

**Why It Fails:**
- **Assumes standard HTML structure:** Real-world sites (especially Elementor exports) don't use semantic HTML consistently
- **Pattern matching is fragile:** A single missing tag breaks the entire extraction
- **No validation:** Doesn't verify that extracted header/footer are actually correct
- **Caching compounds errors:** If extraction fails once, wrong header/footer is cached and used for all future edits
- **No way to fix it:** Users can't manually edit cached templates, only re-run extraction

**Real-World Failure Scenario:**
```
1. SecureTheVote site uses Elementor
2. Header ends with a <div class="elementor-section-wrap"> (no <main> tag)
3. extractHeaderFooter() doesn't find any pattern
4. Falls back to </header> tag, which doesn't exist either
5. headerEnd = 0 (treats entire page as content)
6. Footer extraction similarly fails
7. Cache stores: header = "", footer = ""
8. AI creates a new page using cached templates
9. New page has no header or footer
10. User sees broken page, loses trust in the tool
```

**Frequency:** This affects EVERY site that doesn't use standard semantic HTML — which is most real-world sites.

**2. System Prompt Bloat:**

**The Problem:**
```javascript
const systemPrompt = `You are the Site Editor AI for ${site.domain}.
${basePrompt}
${brandSection}  // ~500 words
${basePrompt}    // Repeated! (appears twice due to bug)

## ABOUT THIS SITE
... (500 words)

## EDITING STRATEGY
... (400 words)

## BRANDING & STYLE GUIDELINES
... (600 words)

## DUAL EDITING SYSTEM
... (800 words with API docs)

... (continues for ~3000 words total)
`;
```

**Measured Token Cost:**
- System prompt: ~3000 words → ~4000 tokens
- Sent on EVERY request (not cached)
- For a 10-message conversation: 40,000 tokens just for repeated instructions
- At $3/million input tokens: $0.12 per conversation (just for system prompt)
- With 100 users making 10 edits/week: $120/week = $6,240/year in wasted tokens

**Why It's Bad:**
- **Token waste:** Most instructions aren't relevant to every request
- **Cognitive load:** AI has to parse 3000 words of instructions before even reading the user's message
- **Confusion:** Mixing multiple concerns (file editing, CMS APIs, branding, communication style) in one wall of text
- **Duplication bug:** `basePrompt` appears twice in the template
- **Maintenance nightmare:** Updating instructions requires editing a giant string

**3. Brand Guide Extraction:**

**Current Implementation:**
```javascript
// Scan CSS for hex colors
const colors = cssContent.match(/#[0-9a-fA-F]{6}/g);
// Pick first 5 unique colors, call them primary/secondary/accent
const brandGuide = {
  colors: {
    primary: colors[0],
    secondary: colors[1],
    accent: colors[2]
  }
};
```

**What It Misses:**
- CSS variables (`--primary-color: #123456`)
- SCSS variables (`$brand-blue: #123456`)
- Computed styles (JavaScript-applied colors)
- RGB/RGBA values (`rgb(18, 52, 86)`)
- Color usage context (which color is for buttons vs. backgrounds)
- Font stacks with fallbacks
- Spacing/sizing systems

**Result:**
- AI gets incomplete/wrong brand information
- Creates content that doesn't match site design
- User has to manually correct every time

**4. File Handling Inefficiency:**

**The Problem:**
- Large Elementor HTML files are 80-120KB
- `read_file` truncates to 300 lines (~15KB)
- AI doesn't see footer, doesn't see full CSS, doesn't see bottom of page
- `write_file` sends entire 100KB file back to GitHub
- For a 100KB file at ~4 characters/token: 25,000 tokens per read+write
- At $3 input + $15 output per million tokens: $0.45 per page edit

**Scale Impact:**
- 10 page edits/day = $4.50/day = $135/month = $1,620/year in token costs
- 50 sites doing 10 edits/month = $810/month = $9,720/year

**5. No Template Library:**

**The Problem:**
- Each site is isolated
- No shared templates across sites
- Can't clone a working site structure for a new client
- Can't maintain brand consistency across related sites (e.g., state chapters)
- Every new site starts from scratch or copies an existing site's files

**Impact:**
- Longer onboarding time
- Inconsistent quality across sites
- Can't build "template marketplace" for users
- Can't implement white-label solution

### 2.3 Scalability Concerns

**1. Database Design:**
Current schema:
```sql
CREATE TABLE sites (
  id UUID PRIMARY KEY,
  domain VARCHAR(255),
  github_repo VARCHAR(255),
  cached_header TEXT,  -- ❌ Stores extracted header (fragile)
  cached_footer TEXT,  -- ❌ Stores extracted footer (fragile)
  brand_guide JSONB,
  config JSONB
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  site_id UUID REFERENCES sites(id),
  messages JSONB  -- ❌ Stores full conversation history (grows unbounded)
);
```

**Problems:**
- `cached_header`/`cached_footer` are derivatives, not source of truth
- No `templates` table (templates are extracted, not stored)
- No `pages` table (pages are just files in GitHub, not database entities)
- No `design_tokens` table (brand guide is semi-structured JSON)
- Sessions table grows unbounded (every message ever sent is stored)

**Scale Issues:**
- 50 sites × 100 pages = 5,000 pages with no index
- Can't query "show me all pages using header template X"
- Can't bulk-update pages when template changes
- Can't track which pages are affected by a change

**2. GitHub API Rate Limits:**
- GitHub API: 5,000 requests/hour for authenticated users
- Current system: 1 read + 1 write per page edit = 2 requests
- With 50 sites, 100 edits/hour across all sites = 200 requests/hour (OK)
- But: Template change affecting 20 pages = 40 requests (all at once)
- Risk of hitting rate limits during bulk operations

**3. Token Costs at Scale:**
Current monthly token usage estimate (conservative):
- 10 sites, 20 edits/site/month = 200 edits
- 200 edits × 30,000 tokens/edit (input+output) = 6M tokens/month
- At Sonnet 4.5 rates ($3 input, $15 output): ~$60/month

At 100 sites:
- 2,000 edits/month × 30,000 tokens = 60M tokens/month
- Estimated cost: ~$600/month

**Potential savings with template system:**
- Reduce tokens/edit from 30,000 to 5,000 (6x reduction)
- 2,000 edits × 5,000 tokens = 10M tokens/month
- Estimated cost: ~$100/month
- **Savings: $500/month = $6,000/year**

---

## Section 3: Gap Analysis

| Feature | Ideal State | Current State | Gap |
|---------|-------------|---------------|-----|
| **Template Storage** | First-class database entities (templates table) | Extracted on-the-fly with regex, cached as text blobs | ❌ **CRITICAL** — No structured template system |
| **Header/Footer Management** | Edit once, updates all pages; stored as reusable components | Extracted from HTML using fragile pattern matching | ❌ **CRITICAL** — Broken for non-standard HTML |
| **Page Content** | Stored as content-only (2-5KB), assembled with templates | Full HTML files (80-120KB) stored in GitHub | ❌ **MAJOR** — Inefficient, token-heavy |
| **Template Editing** | Dedicated template editor, visual diff of affected pages | No way to edit templates directly | ❌ **MAJOR** — Users can't fix broken templates |
| **System Prompt** | Modular, context-aware, tool-based (<500 tokens) | Monolithic 3000-word string (~4000 tokens) | ❌ **MAJOR** — Token waste, confusion |
| **Design System** | Structured design tokens (JSONB), validated on edits | Regex-scraped colors, injected as prose | ⚠️ **MODERATE** — Works but inefficient |
| **Brand Consistency** | Automated validation, rejects non-compliant colors/fonts | AI is told to follow guidelines (often ignored) | ⚠️ **MODERATE** — No enforcement |
| **New Site Creation** | Scaffold from canonical templates, AI customization | Copy from existing site or manual HTML creation | ⚠️ **MODERATE** — Works but slow |
| **Existing Site Import** | One-time template extraction, stored in database | Manual analysis, cached extracts (not revisable) | ⚠️ **MODERATE** — Fragile onboarding |
| **File Operations** | Content-only reads (<1000 tokens), differential writes | Full file reads (25,000 tokens), full file writes | ❌ **MAJOR** — Token waste |
| **QA Automation** | Pre-commit HTML validation, link checking, visual diff | Manual user review only | ⚠️ **MODERATE** — Relies on user QA |
| **Multi-Site Templates** | Shared template library across sites | Each site is isolated | ⚠️ **MINOR** — Nice-to-have |
| **Bulk Operations** | Change template → auto-update all pages in one commit | No bulk update capability | ⚠️ **MODERATE** — Manual work for template changes |
| **Page Database** | Pages indexed in database with metadata | Pages exist only as GitHub files | ⚠️ **MODERATE** — Can't query/analyze pages |
| **Link Validation** | Continuous monitoring, auto-fix broken links | Tool exists but requires manual execution | ⚠️ **MINOR** — Works but underutilized |
| **Token Efficiency** | ~5,000 tokens/edit (content-only, modular prompt) | ~30,000 tokens/edit (full files, monolithic prompt) | ❌ **MAJOR** — 6x token waste |

**Priority Summary:**
- 🔴 **P0 (Fix Now):** Template system, header/footer storage
- 🟡 **P1 (This Week):** System prompt modularization, file handling optimization
- 🟢 **P2 (Next Week):** Design system validation, QA automation
- 🔵 **P3 (Month 2):** Template library, bulk operations, page database

---

## Section 4: Recommendations (Prioritized)

### P0: Fix Header/Footer Template System (Fix Now)

**What to Change:**
Implement first-class template storage and page assembly.

**Why It Matters:**
This is the core problem. Without reliable headers/footers, the tool is broken for production use. Every edit risks breaking navigation or site-wide elements. This erodes trust and makes the tool unusable.

**How to Implement:**

**Step 1: Database Migration (Day 1)**

```sql
-- Create templates table
CREATE TABLE templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL,  -- 'header', 'footer', 'navigation'
  name VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  variables JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create page templates (layouts)
CREATE TABLE page_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,  -- 'Default Page', 'Petition Page'
  header_template_id UUID REFERENCES templates(id),
  footer_template_id UUID REFERENCES templates(id),
  content_placeholder TEXT NOT NULL,  -- HTML showing where content goes
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create pages index
CREATE TABLE pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID REFERENCES sites(id) ON DELETE CASCADE,
  path VARCHAR(500) NOT NULL UNIQUE,  -- dist/index.html
  template_id UUID REFERENCES page_templates(id),
  content TEXT NOT NULL,  -- Just main content, not full page
  metadata JSONB DEFAULT '{}',  -- {title, description}
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes
CREATE INDEX idx_templates_site ON templates(site_id);
CREATE INDEX idx_page_templates_site ON page_templates(site_id);
CREATE INDEX idx_pages_site ON pages(site_id);
CREATE INDEX idx_pages_template ON pages(template_id);

-- Migrate existing sites (one-time)
-- For each site, extract header/footer from cached fields, create templates
-- (This will be a migration script, not manual SQL)
```

**Step 2: Template Extraction Service (Day 1-2)**

Create `lib/template-extractor.js`:

```javascript
/**
 * Analyzes a set of HTML pages and generates canonical templates.
 * Much smarter than current extractHeaderFooter() — uses multiple heuristics.
 */
export async function generateTemplatesFromSite(siteId, htmlFiles) {
  const pages = htmlFiles.map(f => parseHTML(f.content));
  
  // Find common header across all pages
  const header = extractCommonElement(pages, 'header');
  if (!header) {
    throw new Error('Could not identify a consistent header across pages. Manual template creation required.');
  }
  
  // Find common footer
  const footer = extractCommonElement(pages, 'footer');
  if (!footer) {
    throw new Error('Could not identify a consistent footer across pages. Manual template creation required.');
  }
  
  // Store in database
  const headerTemplate = await pool.query(
    'INSERT INTO templates (site_id, type, name, content) VALUES ($1, $2, $3, $4) RETURNING id',
    [siteId, 'header', 'Site Header', header]
  );
  
  const footerTemplate = await pool.query(
    'INSERT INTO templates (site_id, type, name, content) VALUES ($1, $2, $3, $4) RETURNING id',
    [siteId, 'footer', 'Site Footer', footer]
  );
  
  // Create default page template
  const pageTemplate = await pool.query(
    `INSERT INTO page_templates (site_id, name, header_template_id, footer_template_id, content_placeholder)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [siteId, 'Default Page', headerTemplate.rows[0].id, footerTemplate.rows[0].id, 
     '<main>\n  {CONTENT}\n</main>']
  );
  
  // Extract content from each page and index it
  for (const file of htmlFiles) {
    const content = extractMainContent(file.content, header, footer);
    await pool.query(
      'INSERT INTO pages (site_id, path, template_id, content, metadata) VALUES ($1, $2, $3, $4, $5)',
      [siteId, file.path, pageTemplate.rows[0].id, content, {title: extractTitle(file.content)}]
    );
  }
  
  return {
    headerTemplateId: headerTemplate.rows[0].id,
    footerTemplateId: footerTemplate.rows[0].id,
    pageTemplateId: pageTemplate.rows[0].id,
    pagesIndexed: htmlFiles.length
  };
}

/**
 * Extracts common element from multiple pages using similarity analysis.
 * Returns the canonical version that appears in all (or most) pages.
 */
function extractCommonElement(pages, type) {
  // Use multiple strategies:
  // 1. Find <header>/<footer> tags if they exist
  // 2. Find elements that appear in 90%+ of pages
  // 3. Use structural similarity (tree diff) to find common subtrees
  // 4. Fall back to asking user to identify element manually
  
  const candidates = pages.map(p => {
    if (type === 'header') {
      // Try semantic tags first
      let header = p.querySelector('header');
      if (!header) header = p.querySelector('[role="banner"]');
      if (!header) header = p.querySelector('nav');
      if (!header) {
        // Find first major element before main content
        const main = p.querySelector('main, [role="main"], .main-content');
        if (main) {
          header = findPrecedingElement(main);
        }
      }
      return header ? header.outerHTML : null;
    } else if (type === 'footer') {
      let footer = p.querySelector('footer');
      if (!footer) footer = p.querySelector('[role="contentinfo"]');
      if (!footer) {
        // Find last major element after main content
        const main = p.querySelector('main, [role="main"], .main-content');
        if (main) {
          footer = findFollowingElement(main);
        }
      }
      return footer ? footer.outerHTML : null;
    }
  }).filter(Boolean);
  
  if (candidates.length === 0) return null;
  
  // Find most common version (exact string match)
  const counts = {};
  for (const c of candidates) {
    counts[c] = (counts[c] || 0) + 1;
  }
  
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const [mostCommon, count] = sorted[0];
  
  // Require 80% consensus
  if (count / pages.length < 0.8) {
    console.warn(`${type} varies across pages (${count}/${pages.length} match). Using most common version.`);
  }
  
  return mostCommon;
}

/**
 * Extracts main content by removing header and footer.
 */
function extractMainContent(html, header, footer) {
  let content = html;
  content = content.replace(header, '').replace(footer, '');
  
  // Find <main> or main content area
  const parsed = parseHTML(content);
  const main = parsed.querySelector('main, [role="main"], .main-content, .elementor-section-wrap');
  
  return main ? main.innerHTML : content;
}
```

**Step 3: Page Assembly Service (Day 2)**

Create `lib/page-assembler.js`:

```javascript
/**
 * Assembles a full HTML page from templates and content.
 */
export async function assemblePage(pageId) {
  // Get page record
  const pageResult = await pool.query(
    'SELECT * FROM pages WHERE id = $1',
    [pageId]
  );
  const page = pageResult.rows[0];
  
  // Get page template
  const templateResult = await pool.query(
    'SELECT * FROM page_templates WHERE id = $1',
    [page.template_id]
  );
  const template = templateResult.rows[0];
  
  // Get header template
  const headerResult = await pool.query(
    'SELECT content FROM templates WHERE id = $1',
    [template.header_template_id]
  );
  const header = headerResult.rows[0].content;
  
  // Get footer template
  const footerResult = await pool.query(
    'SELECT content FROM templates WHERE id = $1',
    [template.footer_template_id]
  );
  const footer = footerResult.rows[0].content;
  
  // Assemble page
  const contentSection = template.content_placeholder.replace('{CONTENT}', page.content);
  const fullPage = header + '\n' + contentSection + '\n' + footer;
  
  // Update title if specified
  if (page.metadata?.title) {
    fullPage = fullPage.replace(/<title>[^<]*<\/title>/i, `<title>${page.metadata.title}</title>`);
  }
  
  return fullPage;
}

/**
 * Regenerates all pages that use a given template.
 * Used when header/footer templates are edited.
 */
export async function regenerateAllPagesForTemplate(templateId) {
  // Find all page templates using this header/footer template
  const pageTemplates = await pool.query(
    'SELECT id FROM page_templates WHERE header_template_id = $1 OR footer_template_id = $1',
    [templateId]
  );
  
  // Find all pages using those templates
  const pages = await pool.query(
    'SELECT id, path FROM pages WHERE template_id = ANY($1)',
    [pageTemplates.rows.map(t => t.id)]
  );
  
  const regenerated = [];
  for (const page of pages.rows) {
    const html = await assemblePage(page.id);
    regenerated.push({ path: page.path, html });
  }
  
  return regenerated;
}
```

**Step 4: Update AI Tools (Day 3)**

Replace `replace_page_content` and `create_page` tools:

```javascript
// OLD: replace_page_content (reads full file, extracts header/footer, stitches)
// NEW: update_page_content (updates pages.content, triggers assembly)

tools.push({
  name: "update_page_content",
  description: "Update the main content section of a page. Headers, footers, and navigation are preserved automatically.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Page path (e.g., dist/index.html)" },
      new_content: { type: "string", description: "New HTML content for the main section ONLY. Do not include headers, footers, or full page structure." },
      message: { type: "string", description: "Commit message" }
    },
    required: ["path", "new_content"]
  }
});

// Implementation
if (toolName === 'update_page_content') {
  const { path, new_content, message } = toolInput;
  
  // Get page from database
  const pageResult = await pool.query('SELECT * FROM pages WHERE path = $1 AND site_id = $2', [path, req.params.siteId]);
  if (pageResult.rows.length === 0) {
    return `Error: Page not found at ${path}. Use list_files to see available pages.`;
  }
  const page = pageResult.rows[0];
  
  // Update content in database
  await pool.query('UPDATE pages SET content = $1, updated_at = NOW() WHERE id = $2', [new_content, page.id]);
  
  // Assemble full page from templates
  const fullPage = await assemblePage(page.id);
  
  // Write to GitHub
  const [owner, repoName] = site.github_repo.split('/');
  const writeResp = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/contents/${path}`,
    {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${site.github_token}`, 'Accept': 'application/vnd.github.v3+json' },
      body: JSON.stringify({
        message: message || 'Update page content via AI editor',
        content: Buffer.from(fullPage).toString('base64'),
        branch: 'staging',
        sha: page.github_sha  // Store this when indexing pages
      })
    }
  );
  
  if (!writeResp.ok) {
    const err = await writeResp.json();
    return `Error writing to GitHub: ${err.message}`;
  }
  
  return `Page updated successfully. Header, footer, and navigation preserved. Click 'Preview Edits' to see the changes.`;
}
```

Add new tool for editing templates:

```javascript
tools.push({
  name: "update_template",
  description: "Edit a header, footer, or navigation template. Changes will apply to ALL pages that use this template.",
  input_schema: {
    type: "object",
    properties: {
      template_type: { type: "string", enum: ["header", "footer", "navigation"] },
      new_content: { type: "string", description: "New HTML for the template" },
      message: { type: "string", description: "Commit message explaining the change" }
    },
    required: ["template_type", "new_content"]
  }
});

// Implementation
if (toolName === 'update_template') {
  const { template_type, new_content, message } = toolInput;
  
  // Get template
  const templateResult = await pool.query(
    'SELECT * FROM templates WHERE site_id = $1 AND type = $2',
    [req.params.siteId, template_type]
  );
  if (templateResult.rows.length === 0) {
    return `Error: No ${template_type} template found for this site.`;
  }
  const template = templateResult.rows[0];
  
  // Update template in database
  await pool.query('UPDATE templates SET content = $1, updated_at = NOW() WHERE id = $2', [new_content, template.id]);
  
  // Regenerate all pages that use this template
  const regenerated = await regenerateAllPagesForTemplate(template.id);
  
  // Batch commit to GitHub
  const [owner, repoName] = site.github_repo.split('/');
  for (const { path, html } of regenerated) {
    // Get current file SHA
    const fileResp = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${path}?ref=staging`,
      { headers: { 'Authorization': `Bearer ${site.github_token}` } }
    );
    const fileData = await fileResp.json();
    
    // Update file
    await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/contents/${path}`,
      {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${site.github_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: message || `Update ${template_type} template`,
          content: Buffer.from(html).toString('base64'),
          branch: 'staging',
          sha: fileData.sha
        })
      }
    );
  }
  
  return `${template_type} template updated. ${regenerated.length} pages regenerated. All changes committed to staging. Click 'Preview Edits' to review.`;
}
```

**Step 5: Migration Script (Day 3)**

Create `scripts/migrate-to-templates.js`:

```javascript
/**
 * One-time migration: convert existing sites to use template system.
 */
import pg from 'pg';
import { generateTemplatesFromSite } from '../lib/template-extractor.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  const sites = await pool.query('SELECT * FROM sites');
  
  for (const site of sites.rows) {
    console.log(`Migrating site: ${site.domain}`);
    
    try {
      // Fetch all HTML files from GitHub
      const files = await fetchAllHTMLFiles(site.github_repo, site.github_token);
      
      // Generate templates
      const result = await generateTemplatesFromSite(site.id, files);
      
      console.log(`  ✓ Created ${result.pagesIndexed} page records`);
      console.log(`  ✓ Header template: ${result.headerTemplateId}`);
      console.log(`  ✓ Footer template: ${result.footerTemplateId}`);
    } catch (error) {
      console.error(`  ✗ Migration failed for ${site.domain}:`, error.message);
      console.error(`  → Manual template creation required for this site.`);
    }
  }
  
  console.log('Migration complete.');
}

migrate();
```

**Expected Impact:**
- **Headers/footers work 100% of the time** (no more extraction failures)
- **Edit once, update everywhere** (change header → all pages update)
- **Users can fix templates** (manual editor if auto-extraction fails)
- **Foundation for all other improvements** (everything else depends on this)

**Time Estimate:** 3 days (1 day for database + extraction, 1 day for assembly, 1 day for tool updates + migration)

---

### P1: Modularize System Prompt (This Week)

**What to Change:**
Break monolithic system prompt into modular, context-aware sections. Load only what's needed for each request.

**Why It Matters:**
Currently wasting ~4,000 tokens per request on repeated instructions. At scale (100 sites, 2,000 edits/month), this costs ~$200/month. Modularization would reduce to ~$50/month. Savings: **$1,800/year**.

**How to Implement:**

**Step 1: Baseline System Prompt (Day 1)**

Create `lib/prompts/base.js`:

```javascript
export function getBasePrompt(site) {
  return `You are the Site Editor AI for ${site.domain}.

You help the site owner create and edit web pages through conversation. You can read files, write files, and use various tools to manage the website.

**Your Role:**
- Edit website content based on user requests
- Maintain site-wide design consistency
- Preserve headers, footers, and navigation automatically
- Keep responses brief and friendly (1-2 sentences)
- Never use technical jargon (no "branches", "repos", "commits", etc.)

**After making changes:** Tell the user to click "Preview Edits" to see the result.
`;
}
```

**Step 2: Tool-Specific Prompts (Day 1)**

Create `lib/prompts/tools.js`:

```javascript
export function getToolGuidance(toolsAvailable) {
  const guidance = {
    update_page_content: `
**Editing Pages:**
- Use update_page_content to edit the main content of a page
- You only edit the content section — headers and footers are preserved automatically
- Provide clean, well-structured HTML for the main content area
`,
    update_template: `
**Editing Templates:**
- Use update_template to edit headers, footers, or navigation
- Changes apply to ALL pages that use the template
- Be careful — this affects the entire site
`,
    verify_links: `
**Link Validation:**
- Before creating links to other pages, use verify_links to confirm the page exists
- Common pages: /petition/, /contact-us/, /about-us/
`,
    capture_screenshot: `
**Visual Preview:**
- Use capture_screenshot to see what a page looks like visually
- Useful for verifying layout and styling
`
  };
  
  return toolsAvailable
    .map(t => guidance[t.name])
    .filter(Boolean)
    .join('\n');
}
```

**Step 3: Design System Prompt (Day 2)**

Create `lib/prompts/design-system.js`:

```javascript
export function getDesignSystemPrompt(brandGuide) {
  if (!brandGuide || Object.keys(brandGuide).length === 0) {
    return '';
  }
  
  return `
**Brand Colors (use these for all design):**
${Object.entries(brandGuide.colors || {}).map(([name, value]) => `- ${name}: ${value}`).join('\n')}

**Typography:**
${Object.entries(brandGuide.fonts || {}).map(([name, value]) => `- ${name}: ${value}`).join('\n')}

**Important:** Always use these brand colors and fonts. Never invent new colors or styles.
`;
}
```

**Step 4: Assemble Prompt Dynamically (Day 2)**

Update `server.js`:

```javascript
import { getBasePrompt } from './lib/prompts/base.js';
import { getToolGuidance } from './lib/prompts/tools.js';
import { getDesignSystemPrompt } from './lib/prompts/design-system.js';

function buildSystemPrompt(site, tools) {
  const sections = [
    getBasePrompt(site),
    getDesignSystemPrompt(site.brand_guide),
    getToolGuidance(tools),
    site.config?.customInstructions || ''
  ].filter(Boolean);
  
  return sections.join('\n\n---\n\n');
}
```

**Step 5: Provide Brand Guide as Tool (Day 3)**

Instead of injecting brand guide into prompt, provide it as a tool:

```javascript
tools.push({
  name: "get_design_system",
  description: "Get the site's brand colors, fonts, and design guidelines. Use this when creating or editing styled content.",
  input_schema: { type: "object", properties: {} }
});

if (toolName === 'get_design_system') {
  const brandGuide = site.brand_guide || {};
  return JSON.stringify({
    colors: brandGuide.colors || {},
    fonts: brandGuide.fonts || {},
    button_style: brandGuide.button_style || 'Not documented',
    layout_notes: brandGuide.layout_notes || 'Not documented'
  }, null, 2);
}
```

**Expected Impact:**
- System prompt reduced from 3,000 words to ~300 words
- Token usage per request: 4,000 → 400 (10x reduction)
- Cost savings: ~$150/month at 100-site scale
- Faster AI responses (less to parse)
- Easier to maintain and update prompts

**Time Estimate:** 3 days

---

### P2: Optimize File Handling (This Week)

**What to Change:**
AI should only read/write page content (2-5KB), not full HTML files (100KB).

**Why It Matters:**
Large file reads cost 25,000 tokens each. Content-only reads cost 500 tokens. **50x reduction** in token usage for file operations.

**How to Implement:**

This is mostly done by the P0 template system. Additional changes:

**Step 1: Update read_file Tool (Day 1)**

```javascript
// OLD: read_file returns full HTML from GitHub
// NEW: read_file returns pages.content from database (unless full_page=true)

tools.push({
  name: "read_file",
  description: "Read the content of a page. Returns only the main content section by default (fast, efficient). Use full_page=true if you need to see headers/footers.",
  input_schema: {
    type: "object",
    properties: {
      path: { type: "string", description: "Page path (e.g., dist/index.html)" },
      full_page: { type: "boolean", description: "If true, returns the full assembled HTML. If false (default), returns only the main content section." }
    },
    required: ["path"]
  }
});

if (toolName === 'read_file') {
  const { path, full_page } = toolInput;
  
  // Get page from database
  const pageResult = await pool.query('SELECT * FROM pages WHERE path = $1 AND site_id = $2', [path, req.params.siteId]);
  
  if (pageResult.rows.length === 0) {
    return `Error: Page not found in database. This page may not have been indexed yet.`;
  }
  
  const page = pageResult.rows[0];
  
  if (full_page) {
    // Assemble and return full page
    const fullPage = await assemblePage(page.id);
    return fullPage;
  } else {
    // Return just content section (default)
    return page.content;
  }
}
```

**Step 2: Update System Prompt Guidance (Day 1)**

```javascript
// In base prompt:
`
**Editing Workflow:**
1. Read the page content with read_file (returns just the main content — very fast)
2. Edit the content HTML
3. Write back with update_page_content (headers/footers preserved automatically)

**Do NOT read full pages unless you need to debug headers/footers.** The default read_file returns only the editable content section.
`
```

**Expected Impact:**
- Average token usage per edit: 30,000 → 5,000 (6x reduction)
- Cost per edit: $0.45 → $0.075 (6x cheaper)
- At 2,000 edits/month: $900/month → $150/month
- **Savings: $750/month = $9,000/year**

**Time Estimate:** 1 day (depends on P0 being complete)

---

### P3: Improve Design System Extraction (Next Week)

**What to Change:**
Extract design tokens more intelligently — CSS variables, computed styles, color usage context.

**Why It Matters:**
Current extraction misses CSS variables and doesn't understand color roles (primary vs. accent). AI creates content with wrong colors. Better extraction → better brand consistency → fewer manual corrections.

**How to Implement:**

**Step 1: Enhanced CSS Parsing (Day 1)**

Create `lib/design-token-extractor.js`:

```javascript
import postcss from 'postcss';
import { JSDOM } from 'jsdom';

/**
 * Extracts design tokens from CSS files and HTML.
 */
export async function extractDesignTokens(cssFiles, htmlSample) {
  const tokens = {
    colors: {},
    typography: {},
    spacing: {}
  };
  
  // Parse CSS with PostCSS (handles CSS variables, SCSS, etc.)
  for (const file of cssFiles) {
    const root = postcss.parse(file.content);
    
    // Extract CSS variables
    root.walkRules(':root', rule => {
      rule.walkDecls(decl => {
        if (decl.prop.startsWith('--')) {
          const name = decl.prop.slice(2);  // Remove '--'
          if (isColorValue(decl.value)) {
            tokens.colors[name] = decl.value;
          } else if (isFontValue(decl.value)) {
            tokens.typography[name] = decl.value;
          } else if (isSpacingValue(decl.value)) {
            tokens.spacing[name] = decl.value;
          }
        }
      });
    });
    
    // Extract regular color declarations
    root.walkDecls(decl => {
      if (decl.prop === 'color' || decl.prop === 'background-color') {
        if (isColorValue(decl.value)) {
          const context = inferColorContext(decl);  // 'text', 'background', 'accent', etc.
          if (!tokens.colors[context]) {
            tokens.colors[context] = decl.value;
          }
        }
      }
    });
    
    // Extract typography
    root.walkDecls(decl => {
      if (decl.prop === 'font-family') {
        const context = inferFontContext(decl);  // 'heading', 'body', etc.
        tokens.typography[context] = decl.value;
      }
    });
  }
  
  // If CSS variables not found, analyze HTML computed styles
  if (Object.keys(tokens.colors).length < 3) {
    const dom = new JSDOM(htmlSample);
    const computed = analyzeComputedStyles(dom.window.document);
    tokens.colors = { ...computed.colors, ...tokens.colors };
    tokens.typography = { ...computed.typography, ...tokens.typography };
  }
  
  // Assign semantic names (primary, secondary, accent) based on usage frequency
  tokens.colors = assignSemanticNames(tokens.colors);
  
  return tokens;
}

function isColorValue(value) {
  return /^(#[0-9a-f]{3,8}|rgb|hsl|var\(--)/i.test(value);
}

function inferColorContext(decl) {
  // Look at selector to infer usage
  const selector = decl.parent.selector;
  if (/button|btn|cta/i.test(selector)) return 'button';
  if (/heading|h[1-6]/i.test(selector)) return 'heading';
  if (/link|a:/i.test(selector)) return 'link';
  if (/background|bg/i.test(selector)) return 'background';
  return 'text';
}

function assignSemanticNames(colors) {
  // Analyze color usage frequency and context to assign semantic names
  const usageCounts = {};
  for (const [context, value] of Object.entries(colors)) {
    usageCounts[value] = (usageCounts[value] || 0) + 1;
  }
  
  const sorted = Object.entries(usageCounts).sort((a, b) => b[1] - a[1]);
  
  return {
    primary: sorted[0]?.[0] || '#000000',
    secondary: sorted[1]?.[0] || '#666666',
    accent: sorted[2]?.[0] || '#0066cc',
    ...colors  // Keep all original mappings too
  };
}
```

**Step 2: Store Enhanced Tokens (Day 2)**

Update site onboarding to use new extractor:

```javascript
// In /sites/:siteId/cache-layout route
const cssFiles = await fetchCSSFiles(site.github_repo, site.github_token);
const htmlSample = await fetchFile(site.github_repo, 'dist/index.html', site.github_token);

const designTokens = await extractDesignTokens(cssFiles, htmlSample);

await pool.query(
  'UPDATE sites SET brand_guide = $1 WHERE id = $2',
  [designTokens, siteId]
);
```

**Step 3: Validation on Edits (Day 3)**

Add validation to `update_page_content` tool:

```javascript
// After AI generates new content
const validation = validateDesignTokens(new_content, site.brand_guide);

if (validation.violations.length > 0) {
  console.warn('Design token violations detected:', validation.violations);
  // Could auto-correct or warn user
}

function validateDesignTokens(html, brandGuide) {
  const violations = [];
  const allowedColors = Object.values(brandGuide.colors || {});
  
  // Scan HTML for color values
  const colorMatches = html.match(/(color|background-color|border-color):\s*([^;]+)/g);
  for (const match of colorMatches || []) {
    const color = match.split(':')[1].trim();
    if (!allowedColors.includes(color) && !color.startsWith('var(--')) {
      violations.push({ type: 'color', value: color, message: 'Non-standard color used' });
    }
  }
  
  return { violations };
}
```

**Expected Impact:**
- Accurate brand color extraction (CSS variables, computed styles)
- Better AI compliance with brand guidelines
- Fewer manual corrections by users
- Foundation for design system validation

**Time Estimate:** 3 days

---

### P4: QA Automation (Month 2)

**What to Change:**
Add automated validation before committing changes.

**Why It Matters:**
Prevents broken links, invalid HTML, and design inconsistencies from reaching staging.

**How to Implement:**

**Step 1: Pre-Commit Validation Pipeline (Week 1)**

Create `lib/qa-validator.js`:

```javascript
import { validateHTML } from 'html-validator';
import { checkLinks } from './link-checker.js';
import { validateDesignTokens } from './design-token-validator.js';

export async function validatePageBeforeCommit(html, site) {
  const results = {
    passed: true,
    errors: [],
    warnings: []
  };
  
  // 1. HTML Validation
  try {
    const htmlValidation = await validateHTML(html);
    if (htmlValidation.errors && htmlValidation.errors.length > 0) {
      results.errors.push(...htmlValidation.errors.map(e => `HTML: ${e.message}`));
      results.passed = false;
    }
  } catch (error) {
    results.warnings.push(`HTML validation skipped: ${error.message}`);
  }
  
  // 2. Link Checking
  const brokenLinks = await checkLinks(html, site);
  if (brokenLinks.length > 0) {
    results.errors.push(...brokenLinks.map(l => `Broken link: ${l.href}`));
    results.passed = false;
  }
  
  // 3. Design Token Compliance
  const tokenValidation = validateDesignTokens(html, site.brand_guide);
  if (tokenValidation.violations.length > 0) {
    results.warnings.push(...tokenValidation.violations.map(v => `Design: ${v.message}`));
    // Don't fail on design violations, just warn
  }
  
  return results;
}
```

**Step 2: Integrate into Tools (Week 1)**

Update `update_page_content`:

```javascript
// Before writing to GitHub
const fullPage = await assemblePage(page.id);
const qaResults = await validatePageBeforeCommit(fullPage, site);

if (!qaResults.passed) {
  return `❌ QA validation failed:\n${qaResults.errors.join('\n')}\n\nPlease fix these issues and try again.`;
}

if (qaResults.warnings.length > 0) {
  console.warn('QA warnings:', qaResults.warnings);
}

// Proceed with GitHub write...
```

**Step 3: Continuous Monitoring (Week 2)**

Add daily cron job to check all sites:

```javascript
// scripts/qa-monitor.js
import { checkAllSites } from './lib/qa-validator.js';

async function runDailyQA() {
  const sites = await pool.query('SELECT * FROM sites');
  
  for (const site of sites.rows) {
    const pages = await pool.query('SELECT * FROM pages WHERE site_id = $1', [site.id]);
    
    for (const page of pages.rows) {
      const html = await assemblePage(page.id);
      const qa = await validatePageBeforeCommit(html, site);
      
      if (!qa.passed || qa.warnings.length > 0) {
        // Log to admin dashboard
        await logQAIssue(site.id, page.id, qa);
      }
    }
  }
}

// Run daily at 2 AM
```

**Expected Impact:**
- Prevents broken links from being deployed
- Catches HTML errors before users see them
- Improves overall site quality
- Reduces support burden

**Time Estimate:** 1-2 weeks

---

## Section 5: Proposed New Architecture

### 5.1 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User (Client)                           │
│                    (Non-technical website owner)                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │ Chat messages via
                             │ Admin Dashboard
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Site Builder AI (Express)                     │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                     Chat Handler                           │ │
│  │  • Receives user message                                   │ │
│  │  • Loads site context from database                        │ │
│  │  • Assembles modular system prompt (~400 tokens)           │ │
│  │  • Defines AI tools (update_page_content, etc.)            │ │
│  └────────────────────────┬───────────────────────────────────┘ │
│                           │                                      │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │               Claude API (Anthropic)                       │ │
│  │  • Sonnet 4.5 model                                        │ │
│  │  • Receives system prompt + tools + user message           │ │
│  │  • Executes up to 25 tool turns                            │ │
│  │  • Returns response                                        │ │
│  └────────────────────────┬───────────────────────────────────┘ │
│                           │                                      │
│                           │ Tool calls                           │
│                           ▼                                      │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │                    Tool Executor                           │ │
│  │                                                             │ │
│  │  read_file          → Reads pages.content from DB          │ │
│  │  update_page_content → Updates DB, triggers assembly       │ │
│  │  update_template    → Updates template, regenerates pages  │ │
│  │  verify_links       → Checks if links are valid            │ │
│  │  get_design_system  → Returns brand guide JSON             │ │
│  │  capture_screenshot → Takes screenshot via Playwright      │ │
│  └────────────────────────┬───────────────────────────────────┘ │
│                           │                                      │
└───────────────────────────┼──────────────────────────────────────┘
                            │
         ┌──────────────────┼──────────────────┐
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐
│   PostgreSQL    │  │  GitHub API     │  │  Vercel API      │
│   (Railway)     │  │                 │  │                  │
│                 │  │  • Staging      │  │  • Auto-deploy   │
│  • sites        │  │    branch       │  │    on push       │
│  • templates    │  │  • Main branch  │  │  • Preview URLs  │
│  • page_templates│ │  • File storage │  │                  │
│  • pages        │  │                 │  │                  │
│  • sessions     │  │                 │  │                  │
└─────────────────┘  └─────────────────┘  └──────────────────┘
```

### 5.2 Data Flow: Creating a New Page

```
1. User: "Create an 'About Us' page"
   │
   ├─> Chat Handler receives message
   │
   ├─> Loads site from database (id, templates, design_tokens)
   │
   ├─> Sends to Claude with tools
   │
   └─> Claude calls: create_page(title="About Us", content="<h1>About Us</h1>...")
       │
       ├─> Tool Executor:
       │   ├─> Gets page template from database (page_templates table)
       │   ├─> Creates new page record (pages table)
       │   ├─> Stores content in pages.content
       │   ├─> Calls assemblePage(pageId)
       │       │
       │       ├─> Fetches header template (templates table)
       │       ├─> Fetches footer template (templates table)
       │       ├─> Assembles: header + content + footer
       │       └─> Returns full HTML
       │   │
       │   ├─> Validates HTML (QA check)
       │   ├─> Writes full HTML to GitHub (staging branch)
       │   └─> Returns success
       │
       └─> Claude: "Done! I've created the About Us page. Click 'Preview Edits'."
```

### 5.3 Data Flow: Editing a Header (Template Change)

```
1. User: "Add a 'Donate' link to the navigation"
   │
   ├─> Chat Handler receives message
   │
   ├─> Claude calls: update_template(type="header", new_content="<header>...<a href='/donate'>Donate</a>...</header>")
       │
       ├─> Tool Executor:
       │   ├─> Finds header template (templates table WHERE type='header')
       │   ├─> Updates templates.content with new HTML
       │   ├─> Calls regenerateAllPagesForTemplate(templateId)
       │       │
       │       ├─> Finds all page_templates using this header
       │       ├─> Finds all pages using those templates (could be 50+ pages)
       │       ├─> For each page:
       │       │   ├─> Calls assemblePage(pageId)
       │       │   ├─> Generates full HTML with NEW header
       │       │   └─> Queues for GitHub write
       │       └─> Returns list of regenerated pages
       │   │
       │   ├─> Batch writes to GitHub (single commit, multiple files)
       │   │   ├─> Commit message: "Update header template (affects 50 pages)"
       │   │   └─> Pushes to staging branch
       │   │
       │   └─> Returns success: "50 pages updated"
       │
       └─> Claude: "Navigation updated with Donate link. 50 pages regenerated. Click 'Preview Edits'."
```

### 5.4 Template System Design

**Database Relationships:**

```
sites
  ├─> templates (1:many)
  │     ├─ header
  │     ├─ footer
  │     └─ navigation
  │
  ├─> page_templates (1:many)
  │     ├─ Default Page
  │     ├─ Petition Page
  │     └─ Blog Post
  │         ├── references templates.id (header_template_id)
  │         └── references templates.id (footer_template_id)
  │
  └─> pages (1:many)
        ├─ dist/index.html
        ├─ dist/about/index.html
        └─ dist/petition/index.html
            ├── references page_templates.id (template_id)
            └── stores content (main section HTML only)
```

**Template Composition:**

```html
<!-- Header Template (templates.content WHERE type='header') -->
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>{TITLE}</title>
  <link rel="stylesheet" href="/css/styles.css">
</head>
<body>
  <header>
    <nav>
      <a href="/">Home</a>
      <a href="/about">About</a>
      <a href="/petition">Petition</a>
    </nav>
  </header>

<!-- Page Template (page_templates.content_placeholder) -->
  <main>
    {CONTENT}
  </main>

<!-- Footer Template (templates.content WHERE type='footer') -->
  <footer>
    <p>&copy; 2024 SecureTheVote MD</p>
  </footer>
</body>
</html>
```

**Assembly Process:**

```javascript
function assemblePage(pageId) {
  const page = db.query('SELECT * FROM pages WHERE id = $1', [pageId]);
  const template = db.query('SELECT * FROM page_templates WHERE id = $1', [page.template_id]);
  const header = db.query('SELECT content FROM templates WHERE id = $1', [template.header_template_id]);
  const footer = db.query('SELECT content FROM templates WHERE id = $1', [template.footer_template_id]);
  
  let html = header.content;
  html = html.replace('{TITLE}', page.metadata.title);
  html += '\n' + template.content_placeholder.replace('{CONTENT}', page.content);
  html += '\n' + footer.content;
  
  return html;
}
```

### 5.5 How Headers/Footers Work in the New System

**Key Principle:** Templates are **source of truth**, not extracted artifacts.

**Onboarding Flow:**

1. **New Site from Scratch:**
   - User selects a template (e.g., "Modern Nonprofit")
   - System clones pre-built templates from template library
   - Header, footer, and page layouts are stored in database
   - No extraction needed

2. **Existing Site Import:**
   - User uploads HTML files or provides GitHub repo
   - System analyzes files with `extractCommonElement()` (multi-strategy)
   - Generates canonical header/footer templates
   - Stores in database
   - Extracts main content from each page
   - **If extraction fails:** User manually defines header/footer boundaries in UI

**Editing Flow:**

1. **Content Edit (Most Common):**
   - AI reads `pages.content` (2-5KB, just main section)
   - AI edits content
   - System re-assembles full page from template + new content
   - Writes to GitHub
   - Header/footer never touched

2. **Template Edit (Rare):**
   - AI reads `templates.content` for header
   - AI edits header (e.g., adds a link)
   - System updates template in database
   - System regenerates ALL pages using this template
   - Batch commits to GitHub
   - All pages now have updated header

**Benefits:**

- **Zero extraction failures:** Templates are explicit entities, not inferred
- **Consistency guaranteed:** All pages use the same header/footer
- **Edit once, update everywhere:** Change template → all pages update
- **User can fix:** If auto-extraction fails during import, user edits template manually
- **Fast AI processing:** AI only reads/edits content sections, not full pages
- **Auditability:** Can see exactly which pages use which templates

---

## Conclusion

The core problem with Site Builder AI is **architectural**, not a bug to be patched. The system treats templates as ephemeral extracts rather than first-class entities. This makes headers and footers fragile and unreliable.

**The fix is not to improve regex patterns** — it's to **eliminate extraction entirely** by making templates the source of truth.

**Priority Roadmap:**

1. **Week 1 (P0):** Implement template system (database schema, extraction service, page assembly, tool updates, migration)
2. **Week 2 (P1):** Modularize system prompt, optimize file handling
3. **Week 3 (P2):** Improve design system extraction
4. **Month 2 (P3):** QA automation, template library, bulk operations

**Expected Outcomes:**

- ✅ Headers/footers work 100% of the time
- ✅ Token costs reduced by 80% ($900/month → $150/month at scale)
- ✅ Faster AI responses (less context to process)
- ✅ Better brand consistency (design token validation)
- ✅ Scalable to 100+ sites
- ✅ Users can fix templates manually if needed
- ✅ Foundation for advanced features (template marketplace, white-label, multi-site management)

**This is the path to a production-ready AI website builder that Roddy can confidently offer to clients.**

---

*End of Document*
