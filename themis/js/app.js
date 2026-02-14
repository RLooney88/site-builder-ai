// Themis - Main App Logic, Auth, and Routing

window.THEMIS_CONFIG = {
  apiBase: window.location.hostname === 'localhost' 
    ? 'http://localhost:3000' 
    : 'https://site-builder-ai-production.up.railway.app',
  appName: 'Themis',
  version: '1.0.0'
};

// Global State
const AppState = {
  token: localStorage.getItem('themis_token') || null,
  currentSite: null,
  currentTab: 'ai-editor',
  sites: []
};

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
  initializeApp();
});

async function initializeApp() {
  // Check if user is logged in
  if (AppState.token) {
    try {
      await loadSites();
      showDashboard();
      
      // Get site from URL parameter or use first site
      const urlParams = new URLSearchParams(window.location.search);
      const siteParam = urlParams.get('site');
      
      if (siteParam) {
        selectSite(siteParam);
      } else if (AppState.sites.length > 0) {
        selectSite(AppState.sites[0].id);
      }
    } catch (error) {
      console.error('Failed to load sites:', error);
      logout();
    }
  } else {
    showLogin();
  }
  
  // Setup event listeners
  setupEventListeners();
}

function setupEventListeners() {
  // Login form
  const loginForm = document.getElementById('login-form');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }
  
  // Logout button
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
  
  // Site selector
  const siteSelect = document.getElementById('site-select');
  if (siteSelect) {
    siteSelect.addEventListener('change', (e) => {
      selectSite(e.target.value);
    });
  }
  
  // Tab navigation
  const tabBtns = document.querySelectorAll('.tab-btn');
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      switchTab(btn.dataset.tab);
    });
  });
  
  // Preview/Publish buttons
  const previewBtn = document.getElementById('preview-btn');
  const publishBtn = document.getElementById('publish-btn');
  
  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      if (AppState.currentSite) {
        window.deployModule.triggerDeployment('preview');
      } else {
        alert('Please select a site first');
      }
    });
  }
  
  if (publishBtn) {
    publishBtn.addEventListener('click', () => {
      if (AppState.currentSite) {
        if (confirm('Publish all changes to production?')) {
          window.deployModule.triggerDeployment('publish');
        }
      } else {
        alert('Please select a site first');
      }
    });
  }
}

// Authentication
async function handleLogin(e) {
  e.preventDefault();
  
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const errorDiv = document.getElementById('login-error');
  
  errorDiv.style.display = 'none';
  
  try {
    const res = await fetch(`${THEMIS_CONFIG.apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    
    const data = await res.json();
    
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }
    
    // Store token
    AppState.token = data.token;
    localStorage.setItem('themis_token', data.token);
    
    // Load sites and show dashboard
    await loadSites();
    showDashboard();
    
    // Select first site by default
    if (AppState.sites.length > 0) {
      selectSite(AppState.sites[0].id);
    }
    
  } catch (error) {
    errorDiv.textContent = error.message;
    errorDiv.style.display = 'block';
  }
}

function logout() {
  AppState.token = null;
  AppState.currentSite = null;
  AppState.sites = [];
  localStorage.removeItem('themis_token');
  showLogin();
}

// Site Management
async function loadSites() {
  const res = await fetch(`${THEMIS_CONFIG.apiBase}/sites`, {
    headers: {
      'Authorization': `Bearer ${AppState.token}`
    }
  });
  
  if (!res.ok) {
    throw new Error('Failed to load sites');
  }
  
  const data = await res.json();
  AppState.sites = data.sites || [];
  
  // Populate site selector
  const siteSelect = document.getElementById('site-select');
  if (siteSelect) {
    siteSelect.innerHTML = '<option value="">Select a site...</option>' +
      AppState.sites.map(site => 
        `<option value="${site.id}">${site.name || site.id}</option>`
      ).join('');
  }
}

function selectSite(siteId) {
  const site = AppState.sites.find(s => s.id === siteId);
  if (!site) return;
  
  AppState.currentSite = site;
  
  // Update site selector
  const siteSelect = document.getElementById('site-select');
  if (siteSelect) {
    siteSelect.value = siteId;
  }
  
  // Update URL without reload
  const url = new URL(window.location);
  url.searchParams.set('site', siteId);
  window.history.pushState({}, '', url);
  
  // Notify modules that site changed
  if (window.chatModule && typeof window.chatModule.onSiteChanged === 'function') {
    window.chatModule.onSiteChanged(site);
  }
  
  if (window.contentModule && typeof window.contentModule.onSiteChanged === 'function') {
    window.contentModule.onSiteChanged(site);
  }
}

// View Management
function showLogin() {
  document.getElementById('login-view').classList.add('active');
  document.getElementById('dashboard-view').classList.remove('active');
}

function showDashboard() {
  document.getElementById('login-view').classList.remove('active');
  document.getElementById('dashboard-view').classList.add('active');
}

// Tab Navigation
function switchTab(tabName) {
  AppState.currentTab = tabName;
  
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabName) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    if (content.id === `tab-${tabName}`) {
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
  
  // Load data for the tab if needed
  if (tabName === 'posts' && window.contentModule) {
    window.contentModule.loadPosts();
  } else if (tabName === 'petitions' && window.contentModule) {
    window.contentModule.loadPetitions();
  } else if (tabName === 'banner' && window.contentModule) {
    window.contentModule.loadBannerSettings();
  } else if (tabName === 'ai-editor' && window.chatModule) {
    window.chatModule.loadHistory();
  }
}

// API Helper
async function apiRequest(endpoint, options = {}) {
  const url = `${THEMIS_CONFIG.apiBase}${endpoint}`;
  const headers = {
    'Content-Type': 'application/json',
    ...options.headers
  };
  
  if (AppState.token) {
    headers['Authorization'] = `Bearer ${AppState.token}`;
  }
  
  const res = await fetch(url, {
    ...options,
    headers
  });
  
  // Handle auth errors
  if (res.status === 401) {
    logout();
    throw new Error('Session expired. Please log in again.');
  }
  
  return res;
}

// Export to window for other modules
window.AppState = AppState;
window.THEMIS_CONFIG = THEMIS_CONFIG;
window.apiRequest = apiRequest;
window.switchTab = switchTab;
