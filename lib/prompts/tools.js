/**
 * Tool-Specific Guidance
 * Provides instructions only for tools actually in use
 */

const TOOL_GUIDANCE = {
  update_page_content: `
**Editing Page Content:**
- Use update_page_content to edit the main content section of a page
- You provide ONLY the new content HTML (not headers, footers, or full page structure)
- The system automatically preserves the site's header, navigation, and footer
- Example: Provide just the <section> or <div> content for the main area`,

  update_template: `
**Editing Site-Wide Templates:**
- Use update_template to edit headers, footers, or navigation
- These changes apply to ALL pages automatically
- The system will regenerate every affected page
- Use with care — this affects the entire site`,

  read_file: `
**Reading Page Content:**
- read_file returns the page's main content section by default (fast, efficient)
- This is what you edit — you don't see headers/footers unless you explicitly request full_page=true
- For large sites, reading just the content section saves 50x tokens`,

  verify_links: `
**Link Validation:**
- ALWAYS use verify_links before creating links to other pages on the site
- Never guess URLs — verify they exist first
- Common pages: /petition/, /contact-us/, /about/, /register/`,

  create_page: `
**Creating New Pages:**
- Use create_page to add a new page using an existing page as a template
- The new page inherits the site's header, footer, and styling automatically
- You only provide the main content and page title`,

  capture_screenshot: `
**Visual Preview:**
- Use capture_screenshot to see what a page looks like visually
- Useful for verifying layout, colors, and styling decisions
- Takes a screenshot of the staging version of the page`,

  search_and_replace: `
**Quick Text Changes:**
- Use search_and_replace for simple text changes (much faster than rewriting the entire page)
- Examples: changing a phone number, updating a link, fixing a typo
- Provide exact text to find and replacement text`,

  get_page_styles: `
**Understanding Page Styling:**
- Use get_page_styles to see what CSS rules apply to a page
- Helps you understand current styling before making changes
- Returns relevant CSS from all stylesheets`,

  validate_html: `
**Quality Assurance:**
- Use validate_html after making complex changes to catch errors
- Checks for unclosed tags, missing quotes, broken structure
- Better to catch problems before the user previews`,

  list_content_templates: `
**Content Templates:**
- ALWAYS call list_content_templates when working with structured content (petitions, posts, events, etc.)
- Templates define how content renders and ensure brand consistency
- Each template has placeholders like {{title}}, {{description}}, and {{brand.colors.primary}}`,

  render_content: `
**Rendering Structured Content:**
- Use render_content to generate HTML from templates
- Provide the template name and a data object with variable values
- The system automatically fills in brand colors, fonts, and data variables
- Example: render_content("petition_card", {"title": "...", "signature_count": 1234, ...})`,

  create_content_template: `
**Creating New Templates:**
- Create templates when users request a new content type that doesn't have one yet
- ALWAYS use brand variables: {{brand.colors.primary}}, {{brand.fonts.heading}}, etc.
- Use {{variable}} for content placeholders (title, description, url, etc.)
- Define modes: ["card", "full", "banner"] to help AI choose the right layout
- Never freestyle layouts for structured content — create a template instead`
};

/**
 * Generate tool guidance based on which tools are available
 * @param {Array} tools - Array of tool definitions
 * @returns {string} - Combined guidance for available tools
 */
export function getToolGuidance(tools) {
  if (!tools || tools.length === 0) {
    return '';
  }

  const guidance = tools
    .map(tool => TOOL_GUIDANCE[tool.name])
    .filter(Boolean)
    .join('\n');

  if (!guidance) {
    return '';
  }

  return `## TOOL USAGE GUIDELINES
${guidance}

**General Tool Rules:**
- Use tools to make actual changes — never just describe what you would do
- Don't read files you don't need to edit (saves tokens)
- One tool call is better than multiple if possible
- Always provide clear commit messages that explain what changed`;
}
