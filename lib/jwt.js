import jwt from 'jsonwebtoken';

/**
 * Generate JWT token for CMS API authentication
 * Uses the site's JWT secret from config
 * @param {Object} siteConfig - Site configuration object
 * @param {Object} payload - Additional payload data
 * @param {string} expiresIn - Expiry time (default: 24h for admin, 1h for AI)
 */
export function generateJWT(siteConfig, payload = {}, expiresIn = '1h') {
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
    { expiresIn }
  );
}

/**
 * Generate admin JWT token with 24-hour expiry
 * @param {string} email - Admin email address
 * @param {string} secret - JWT secret (from env var JWT_SECRET)
 */
export function generateAdminJWT(email, secret = null) {
  const jwtSecret = secret || process.env.JWT_SECRET || 'default-site-builder-secret';
  
  return jwt.sign(
    {
      email,
      role: 'admin',
      source: 'admin-login',
      iat: Math.floor(Date.now() / 1000)
    },
    jwtSecret,
    { expiresIn: '24h' }
  );
}

/**
 * Verify JWT token
 * @param {string} token - JWT token to verify
 * @param {string} secret - JWT secret
 * @returns {Object|null} - Decoded payload or null if invalid
 */
export function verifyJWT(token, secret = null) {
  const jwtSecret = secret || process.env.JWT_SECRET || 'default-site-builder-secret';
  
  try {
    return jwt.verify(token, jwtSecret);
  } catch (error) {
    return null;
  }
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
