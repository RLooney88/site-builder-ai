// Themis - Upload Module (File Upload Dialog & Gallery)

const UploadModule = {
  selectedFile: null,
  
  init() {
    this.setupEventListeners();
  },
  
  setupEventListeners() {
    const uploadBtn = document.getElementById('upload-btn');
    const closeModal = document.getElementById('close-upload-modal');
    const cancelBtn = document.getElementById('cancel-upload-btn');
    const submitBtn = document.getElementById('submit-upload-btn');
    const fileInput = document.getElementById('file-input');
    const uploadZone = document.getElementById('upload-zone');
    
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => this.openUploadDialog());
    }
    
    if (closeModal) {
      closeModal.addEventListener('click', () => this.closeUploadDialog());
    }
    
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this.closeUploadDialog());
    }
    
    if (submitBtn) {
      submitBtn.addEventListener('click', () => this.uploadFile());
    }
    
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.handleFileSelect(e.target.files[0]);
        }
      });
    }
    
    if (uploadZone) {
      uploadZone.addEventListener('click', (e) => {
        if (e.target.tagName !== 'LABEL') {
          fileInput?.click();
        }
      });
      
      uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
      });
      
      uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
      });
      
      uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        
        if (e.dataTransfer.files.length > 0) {
          this.handleFileSelect(e.dataTransfer.files[0]);
        }
      });
    }
  },
  
  openUploadDialog() {
    if (!window.AppState.currentSite) {
      alert('Please select a site first');
      return;
    }
    
    const modal = document.getElementById('upload-modal');
    modal.classList.add('active');
    this.resetUploadDialog();
  },
  
  closeUploadDialog() {
    const modal = document.getElementById('upload-modal');
    modal.classList.remove('active');
    this.resetUploadDialog();
  },
  
  resetUploadDialog() {
    this.selectedFile = null;
    
    const fileInput = document.getElementById('file-input');
    const preview = document.getElementById('upload-preview');
    const submitBtn = document.getElementById('submit-upload-btn');
    
    if (fileInput) fileInput.value = '';
    if (preview) preview.style.display = 'none';
    if (submitBtn) submitBtn.disabled = true;
  },
  
  handleFileSelect(file) {
    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      alert('File size exceeds 10MB limit');
      return;
    }
    
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      alert('Please select an image file (JPG, PNG, GIF, WEBP, SVG)');
      return;
    }
    
    this.selectedFile = file;
    
    // Show preview
    const preview = document.getElementById('upload-preview');
    const previewImg = document.getElementById('preview-img');
    const previewName = document.getElementById('preview-name');
    
    if (preview && previewImg && previewName) {
      preview.style.display = 'flex';
      
      const reader = new FileReader();
      reader.onload = (e) => {
        previewImg.src = e.target.result;
      };
      reader.readAsDataURL(file);
      
      previewName.textContent = file.name;
    }
    
    // Enable submit button
    const submitBtn = document.getElementById('submit-upload-btn');
    if (submitBtn) submitBtn.disabled = false;
  },
  
  async uploadFile() {
    if (!this.selectedFile || !window.AppState.currentSite) return;
    
    const submitBtn = document.getElementById('submit-upload-btn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Uploading...';
    
    try {
      const formData = new FormData();
      formData.append('file', this.selectedFile);
      formData.append('context', 'media');
      
      const res = await fetch(`${window.THEMIS_CONFIG.apiBase}/sites/${window.AppState.currentSite.id}/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${window.AppState.token}`
        },
        body: formData
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Upload failed');
      }
      
      // Success!
      this.closeUploadDialog();
      
      // Show success message in AI chat
      if (window.chatModule && data.url) {
        const fullUrl = `${window.THEMIS_CONFIG.apiBase}${data.url}`;
        window.chatModule.addMessage('assistant', 
          `✓ Image uploaded successfully!\n\nPath: ${data.url}\n\nYou can now ask me to use this image in your site.`
        );
      }
      
    } catch (error) {
      console.error('Upload error:', error);
      alert(`Upload failed: ${error.message}`);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Upload';
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => UploadModule.init());
} else {
  UploadModule.init();
}

// Export to window
window.uploadModule = UploadModule;
