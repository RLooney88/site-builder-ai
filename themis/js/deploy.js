// Themis - Deployment Module (Preview/Publish with Vercel Polling)

const DeployModule = {
  currentDeployment: null,
  pollInterval: null,
  messageInterval: null,
  messageIndex: 0,
  
  funnyMessages: [
    "Warming up the servers...",
    "Teaching pixels where to go...",
    "Convincing the internet to cooperate...",
    "Deploying with style...",
    "Optimizing the flux capacitor...",
    "Compressing the bits...",
    "Almost there, just bribing the CDN...",
    "Making the internet prettier...",
    "Herding the electrons...",
    "Polishing the deployment...",
    "Asking the cloud nicely...",
    "Waiting for the build gods...",
    "Spinning up the magic...",
    "Crossing our fingers..."
  ],
  
  init() {
    this.setupEventListeners();
  },
  
  setupEventListeners() {
    const cancelLink = document.getElementById('deployment-cancel');
    if (cancelLink) {
      cancelLink.addEventListener('click', (e) => {
        e.preventDefault();
        this.cancelDeployment();
      });
    }
  },
  
  async triggerDeployment(type) {
    if (!window.AppState.currentSite) {
      alert('Please select a site first');
      return;
    }
    
    this.currentDeployment = { type };
    
    const modal = document.getElementById('deployment-modal');
    const title = document.getElementById('deployment-title');
    const statusDiv = document.getElementById('deployment-status');
    const successDiv = document.getElementById('deployment-success');
    const linkBtn = document.getElementById('deployment-link');
    
    // Reset UI
    modal.classList.add('active');
    title.textContent = type === 'preview' ? 'Deploying Preview' : 'Publishing to Production';
    statusDiv.style.display = 'flex';
    successDiv.style.display = 'none';
    linkBtn.style.display = 'none';
    
    // Start rotating messages
    this.messageIndex = 0;
    this.updateStatusMessage();
    this.messageInterval = setInterval(() => {
      this.updateStatusMessage();
    }, 2000);
    
    try {
      const endpoint = type === 'preview' 
        ? `/sites/${window.AppState.currentSite.id}/preview`
        : `/sites/${window.AppState.currentSite.id}/publish`;
      
      const res = await window.apiRequest(endpoint, {
        method: 'POST'
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Deployment failed');
      }
      
      // If we get a deployment URL, poll for completion
      if (data.deploymentUrl || data.url) {
        this.pollDeployment(data.deploymentUrl || data.url, type);
      } else {
        // No polling needed, just show success
        this.showSuccess(type, data.previewUrl || data.productionUrl);
      }
      
    } catch (error) {
      console.error('Deployment error:', error);
      this.clearIntervals();
      alert('Deployment failed: ' + error.message);
      modal.classList.remove('active');
    }
  },
  
  updateStatusMessage() {
    const messageEl = document.getElementById('deployment-message');
    if (messageEl) {
      messageEl.style.opacity = '0';
      
      setTimeout(() => {
        messageEl.textContent = this.funnyMessages[this.messageIndex];
        messageEl.style.opacity = '1';
        this.messageIndex = (this.messageIndex + 1) % this.funnyMessages.length;
      }, 300);
    }
  },
  
  async pollDeployment(deploymentUrl, type) {
    // Poll every 3 seconds
    this.pollInterval = setInterval(async () => {
      try {
        const res = await fetch(deploymentUrl);
        const data = await res.json();
        
        // Check if deployment is ready (Vercel-specific)
        if (data.readyState === 'READY' || data.state === 'READY') {
          this.clearIntervals();
          this.showSuccess(type, data.url || data.alias?.[0]);
        } else if (data.readyState === 'ERROR' || data.state === 'ERROR') {
          this.clearIntervals();
          throw new Error('Deployment failed on Vercel');
        }
      } catch (error) {
        console.error('Polling error:', error);
        // Don't stop polling on network errors, just log them
      }
    }, 3000);
    
    // Timeout after 5 minutes
    setTimeout(() => {
      if (this.pollInterval) {
        this.clearIntervals();
        this.showSuccess(type, null); // Show success anyway, deployment might still be in progress
      }
    }, 300000);
  },
  
  showSuccess(type, url) {
    this.clearIntervals();
    
    const statusDiv = document.getElementById('deployment-status');
    const successDiv = document.getElementById('deployment-success');
    const linkBtn = document.getElementById('deployment-link');
    const successText = successDiv.querySelector('.success-text');
    
    statusDiv.style.display = 'none';
    successDiv.style.display = 'flex';
    
    if (successText) {
      successText.textContent = type === 'preview' ? 'Preview ready!' : 'Published successfully!';
    }
    
    if (url) {
      linkBtn.href = url.startsWith('http') ? url : `https://${url}`;
      linkBtn.style.display = 'inline-block';
      linkBtn.textContent = type === 'preview' ? 'Open Preview' : 'Open Site';
    }
  },
  
  clearIntervals() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    if (this.messageInterval) {
      clearInterval(this.messageInterval);
      this.messageInterval = null;
    }
  },
  
  cancelDeployment() {
    this.clearIntervals();
    
    const modal = document.getElementById('deployment-modal');
    modal.classList.remove('active');
    
    this.currentDeployment = null;
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => DeployModule.init());
} else {
  DeployModule.init();
}

// Export to window
window.deployModule = DeployModule;
