# Feature Request: Dynamic CMS Scaffolding

**Date:** 2026-02-13  
**Status:** Planned (Phase 2)  
**Priority:** Medium  
**Complexity:** High  
**Estimated Time:** 2-3 weeks

---

## Overview

Enhance the Site Builder AI to automatically scaffold complete CMS features from natural language requests. Currently, the AI can edit existing files via GitHub API. This feature would allow it to create entire new features (database tables, APIs, admin UI, frontend pages) on demand.

---

## Use Case

**User Request:** "Add an event calendar to my site"

**AI Builder Response:**
1. Creates `events` table in PostgreSQL with appropriate fields
2. Generates CRUD API endpoints at `/api/admin/events.js`
3. Creates publish endpoint at `/api/admin/events/publish-drafts.js`
4. Adds "Events" tab to admin dashboard navigation
5. Generates admin UI form for creating/editing events
6. Creates public `/events` page template
7. Updates site navigation to include Events
8. Pushes all changes to staging branch
9. Returns: "Event calendar created! Preview at [staging URL]"

---

## Required Capabilities

### 1. Database Schema Generation

**Inputs:**
- Feature description (natural language)
- Field requirements
- Relationships to existing tables

**Outputs:**
- SQL migration script
- PostgreSQL table with columns, indexes, constraints
- Automatic `status` column for draft/published workflow
- Automatic timestamps (`created_at`, `updated_at`)

**Example:**
```sql
CREATE TABLE events (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  event_date TIMESTAMPTZ NOT NULL,
  location TEXT,
  registration_link TEXT,
  featured_image TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_date ON events(event_date);
```

### 2. API Endpoint Generation

**Required Endpoints:**
- `GET /api/admin/{feature}` - List with pagination, filtering
- `POST /api/admin/{feature}` - Create (defaults to draft)
- `PUT /api/admin/{feature}?id={id}` - Update
- `DELETE /api/admin/{feature}?id={id}` - Delete
- `POST /api/admin/{feature}/publish-drafts` - Publish all drafts

**Code Template Requirements:**
- JWT authentication (use `requireAuth` helper)
- PostgreSQL connection pooling
- Error handling
- Input validation
- Consistent response format
- Follows existing code patterns

### 3. Admin UI Tab Generation

**Components Needed:**
- Navigation tab button
- Table view with:
  - Pagination
  - Search/filter
  - Sort columns
  - Status badges (draft/published)
  - Action buttons (edit/delete)
- Create/Edit form with:
  - Appropriate field types (text, textarea, date, URL, etc.)
  - Validation
  - Auto-save drafts
  - Preview button
  - Cancel/Save buttons
- Matches existing design system (CSS classes, layout patterns)

### 4. Frontend Page Generation

**Templates:**
- Eleventy `.njk` template for listing page
- Individual item detail page template
- Responsive design matching site theme
- SEO meta tags
- OpenGraph/Twitter cards
- Schema.org markup

**Navigation:**
- Add to site menu automatically
- Breadcrumb integration
- Sitemap.xml update

### 5. File Structure Management

**Proper Organization:**
```
api/
  admin/
    {feature}/
      publish-drafts.js
    {feature}.js
dist/
  {feature}/
    index.html
    [detail-page].html
src/
  {feature}/
    index.njk
    {feature}.njk
```

**Git Integration:**
- Commits to staging branch (not main)
- Descriptive commit messages
- Includes all related files in single commit

---

## Technical Implementation Plan

### Phase 1: Code Generation Templates

Create reusable templates for:
- Database migration SQL
- API endpoint boilerplate
- Admin UI components
- Frontend page templates

**Template Variables:**
- `{feature}` - Feature name (singular)
- `{features}` - Feature name (plural)
- `{fields}` - Array of field definitions
- `{table_name}` - Database table name

### Phase 2: AI Prompt Engineering

Design prompts that:
- Extract feature requirements from natural language
- Determine appropriate field types and constraints
- Generate variable names following conventions
- Validate completeness before execution

### Phase 3: Execution Engine

Build safe execution layer that:
- Validates generated SQL before running
- Lints generated JavaScript
- Tests API endpoints
- Verifies file paths
- Handles rollback on errors

### Phase 4: Preview Integration

Ensure new features work with existing preview workflow:
- New content defaults to draft
- Staging site shows drafts
- Global "Publish" button includes new feature
- Preview URL shows new pages/functionality

---

## Safety & Validation

**Pre-Flight Checks:**
- [ ] SQL injection prevention
- [ ] File path validation (no directory traversal)
- [ ] API route collision detection
- [ ] Database table name uniqueness
- [ ] Code linting passes
- [ ] No hardcoded secrets
- [ ] Follows security best practices

**Rollback Capability:**
- If preview fails, can undo all changes
- Database migrations are reversible
- Git commits can be reverted
- No destructive operations without confirmation

---

## Example Scenarios

### Scenario 1: Event Calendar
**Input:** "Add an event calendar with title, date, location, and registration link"  
**Output:** Full CRUD system for events with public listing page

### Scenario 2: Photo Gallery
**Input:** "Add a photo gallery with categories"  
**Output:** Image upload system, categorization, responsive grid layout

### Scenario 3: Contact Form
**Input:** "Add a contact form with name, email, phone, and message"  
**Output:** Form page, email submission API, admin inbox

### Scenario 4: Team Members
**Input:** "Add a team page with photos, names, titles, and bios"  
**Output:** Team member CMS, grid layout, individual bio pages

---

## Dependencies

- PostgreSQL schema introspection library
- Code generation framework (e.g., Handlebars, EJS)
- SQL parser/validator
- ESLint for JavaScript validation
- Git automation library
- More advanced Claude API usage (longer context, tool use)

---

## Success Metrics

- [ ] AI can scaffold basic CRUD feature in < 2 minutes
- [ ] Generated code passes linting with zero errors
- [ ] Preview workflow works for all generated features
- [ ] Zero security vulnerabilities introduced
- [ ] User can request 5+ different features successfully
- [ ] Rollback works 100% of the time
- [ ] Documentation auto-generated for new features

---

## Future Enhancements

- Visual form builder (drag-and-drop field configuration)
- Import/export feature templates
- Share feature templates between sites
- AI learns from user corrections
- Multi-step wizards for complex features
- Automated testing generation

---

**Last Updated:** 2026-02-13  
**Owner:** Aster  
**Project:** site-builder-ai
