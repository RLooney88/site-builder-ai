/**
 * System Prompt Context Builder
 * Assembles full system prompt from modular components + dynamic context
 */

import { getBasePrompt } from './base.js';
import { getToolGuidance } from './tools.js';

/**
 * Build brand guide section from database config
 * @param {Object} brandGuide - Brand guide from sites.config.brand_guide
 * @returns {string} - Compact brand guide section
 */
function getBrandGuideSection(brandGuide) {
  if (!brandGuide || Object.keys(brandGuide).length === 0) {
    return '';
  }

  const sections = [];

  // Colors (key-value format, not prose)
  if (brandGuide.colors && Object.keys(brandGuide.colors).length > 0) {
    const colorList = Object.entries(brandGuide.colors)
      .map(([name, value]) => `  - ${name}: ${value}`)
      .join('\n');
    sections.push(`**Brand Colors:**\n${colorList}`);
  }

  // Typography (key-value format)
  if (brandGuide.fonts && Object.keys(brandGuide.fonts).length > 0) {
    const fontList = Object.entries(brandGuide.fonts)
      .map(([name, value]) => `  - ${name}: ${value}`)
      .join('\n');
    sections.push(`**Typography:**\n${fontList}`);
  }

  // Button style (if documented)
  if (brandGuide.button_style) {
    sections.push(`**Buttons:** ${brandGuide.button_style}`);
  }

  // Layout notes (if documented)
  if (brandGuide.layout_notes) {
    sections.push(`**Layout:** ${brandGuide.layout_notes}`);
  }

  if (sections.length === 0) {
    return '';
  }

  return `## BRAND GUIDE

${sections.join('\n\n')}

**CRITICAL:** Always use these brand colors and fonts. Never invent new styles.`;
}

/**
 * Build page list section from database
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} siteId - Site ID
 * @returns {Promise<string>} - Page list section
 */
async function getPageListSection(pool, siteId) {
  try {
    const result = await pool.query(
      'SELECT path, metadata FROM pages WHERE site_id = $1 ORDER BY path',
      [siteId]
    );

    if (result.rows.length === 0) {
      return '';
    }

    // Format as path + title only (compact)
    const pageList = result.rows
      .map(page => {
        const title = page.metadata?.title || 'Untitled';
        const urlPath = page.path.replace('dist', '').replace('/index.html', '/');
        return `  - ${urlPath} → ${title}`;
      })
      .join('\n');

    return `## SITE PAGES

${pageList}

Use verify_links before creating links to these pages.`;
  } catch (error) {
    console.warn('[buildSystemPrompt] Could not load page list:', error.message);
    return '';
  }
}

/**
 * Build template info section from database
 * @param {Object} pool - PostgreSQL connection pool
 * @param {string} siteId - Site ID
 * @returns {Promise<string>} - Template info section
 */
async function getTemplateInfoSection(pool, siteId) {
  try {
    const templatesResult = await pool.query(
      'SELECT type, name FROM templates WHERE site_id = $1',
      [siteId]
    );

    const pageTemplatesResult = await pool.query(
      'SELECT name FROM page_templates WHERE site_id = $1',
      [siteId]
    );

    if (templatesResult.rows.length === 0 && pageTemplatesResult.rows.length === 0) {
      return '';
    }

    const sections = [];

    if (templatesResult.rows.length > 0) {
      const templateList = templatesResult.rows
        .map(t => `  - ${t.type}: ${t.name}`)
        .join('\n');
      sections.push(`**Site Components:**\n${templateList}`);
    }

    if (pageTemplatesResult.rows.length > 0) {
      const layoutList = pageTemplatesResult.rows
        .map(t => `  - ${t.name}`)
        .join('\n');
      sections.push(`**Page Layouts:**\n${layoutList}`);
    }

    return `## TEMPLATES

${sections.join('\n\n')}

Templates are reusable components. Editing a template updates all pages that use it.`;
  } catch (error) {
    // Templates table might not exist yet (migration pending)
    console.warn('[buildSystemPrompt] Could not load template info:', error.message);
    return '';
  }
}

/**
 * Build complete system prompt from modular components
 * @param {Object} site - Site object from database
 * @param {Object} pool - PostgreSQL connection pool
 * @param {Array} tools - Array of tool definitions
 * @returns {Promise<string>} - Complete system prompt (~800-1200 tokens)
 */
export async function buildSystemPrompt(site, pool, tools) {
  const sections = [
    // Core behavior (~400 tokens)
    getBasePrompt(site),

    // Brand guide (compact key-value, ~200 tokens)
    getBrandGuideSection(site.brand_guide),

    // Page list (path + title only, ~100-200 tokens)
    await getPageListSection(pool, site.id),

    // Template info (~100 tokens)
    await getTemplateInfoSection(pool, site.id),

    // Tool-specific guidance (only for tools in use, ~200-400 tokens)
    getToolGuidance(tools),

    // Custom instructions from site config (if any)
    site.config?.customInstructions || ''
  ];

  // Filter out empty sections and join
  const prompt = sections
    .filter(s => s && s.trim().length > 0)
    .join('\n\n---\n\n');

  console.log(`[buildSystemPrompt] Generated prompt: ${prompt.length} chars (~${Math.round(prompt.length / 4)} tokens)`);

  return prompt;
}
