import jwt from 'jsonwebtoken';

/**
 * Generate JWT token for CMS API authentication
 * Uses the site's JWT secret from config
 */
export function generateJWT(siteConfig, payload = {}) {
  // Default to a shared secret if site doesn't have one configured
  const secret = siteConfig.jwtSecret || process.env.JWT_SECRET || 'default-site-builder-secret';
  
  const defaultPayload = {
    email: 'ai@sitebuilder.local',
    role: 'admin',
    source: 'site-builder-ai'
  };
  
  return jwt.sign(
    { ...defaultPayload, ...payload },
    secret,
    { expiresIn: '1h' }
  );
}

/**
 * Get CMS API base URL from site config
 */
export function getCMSBaseURL(site) {
  // If site has custom API URL in config, use it
  if (site.config?.cmsApiUrl) {
    return site.config.cmsApiUrl;
  }
  
  // Default: Vercel production URL
  return `https://${site.vercel_project}.vercel.app`;
}
