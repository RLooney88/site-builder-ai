// Themis - Content Management Module (Posts, Petitions, Banner)

const ContentModule = {
  currentPost: null,
  currentPetition: null,
  
  init() {
    this.setupEventListeners();
  },
  
  setupEventListeners() {
    // Posts
    const newPostBtn = document.getElementById('new-post-btn');
    const cancelPostBtn = document.getElementById('cancel-post-btn');
    const postForm = document.getElementById('post-form');
    
    if (newPostBtn) {
      newPostBtn.addEventListener('click', () => this.showPostEditor());
    }
    
    if (cancelPostBtn) {
      cancelPostBtn.addEventListener('click', () => this.showPostsList());
    }
    
    if (postForm) {
      postForm.addEventListener('submit', (e) => this.savePost(e));
    }
    
    // Auto-generate slug from title
    const postTitle = document.getElementById('post-title');
    const postSlug = document.getElementById('post-slug');
    if (postTitle && postSlug) {
      postTitle.addEventListener('input', () => {
        if (!this.currentPost) {
          postSlug.value = this.slugify(postTitle.value);
        }
      });
    }
    
    // Petitions
    const newPetitionBtn = document.getElementById('new-petition-btn');
    const cancelPetitionBtn = document.getElementById('cancel-petition-btn');
    const petitionForm = document.getElementById('petition-form');
    
    if (newPetitionBtn) {
      newPetitionBtn.addEventListener('click', () => this.showPetitionEditor());
    }
    
    if (cancelPetitionBtn) {
      cancelPetitionBtn.addEventListener('click', () => this.showPetitionsList());
    }
    
    if (petitionForm) {
      petitionForm.addEventListener('submit', (e) => this.savePetition(e));
    }
    
    // Banner
    const bannerForm = document.getElementById('banner-form');
    if (bannerForm) {
      bannerForm.addEventListener('submit', (e) => this.saveBannerSettings(e));
    }
    
    // Search and filters
    const postSearch = document.getElementById('post-search');
    const postStatusFilter = document.getElementById('post-status-filter');
    
    if (postSearch) {
      postSearch.addEventListener('input', () => this.loadPosts());
    }
    
    if (postStatusFilter) {
      postStatusFilter.addEventListener('change', () => this.loadPosts());
    }
  },
  
  slugify(text) {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  },
  
  // Posts Management
  async loadPosts() {
    if (!window.AppState.currentSite) return;
    
    const tbody = document.getElementById('posts-list-body');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="4" class="loading-cell">Loading posts...</td></tr>';
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/posts`);
      const data = await res.json();
      
      let posts = data.posts || [];
      
      // Apply filters
      const search = document.getElementById('post-search')?.value.toLowerCase() || '';
      const statusFilter = document.getElementById('post-status-filter')?.value || '';
      
      if (search) {
        posts = posts.filter(p => 
          p.title?.toLowerCase().includes(search) ||
          p.slug?.toLowerCase().includes(search)
        );
      }
      
      if (statusFilter) {
        posts = posts.filter(p => p.status === statusFilter);
      }
      
      if (posts.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="loading-cell">No posts found</td></tr>';
        return;
      }
      
      tbody.innerHTML = posts.map(post => `
        <tr>
          <td>${this.escapeHtml(post.title || 'Untitled')}</td>
          <td><span class="status-badge ${post.status || 'draft'}">${post.status || 'draft'}</span></td>
          <td>${post.date ? new Date(post.date).toLocaleDateString() : 'N/A'}</td>
          <td>
            <button class="action-btn" onclick="window.contentModule.editPost('${post.id}')">Edit</button>
            <button class="action-btn delete" onclick="window.contentModule.deletePost('${post.id}')">Delete</button>
          </td>
        </tr>
      `).join('');
      
    } catch (error) {
      console.error('Failed to load posts:', error);
      tbody.innerHTML = `<tr><td colspan="4" class="loading-cell">Error: ${error.message}</td></tr>`;
    }
  },
  
  showPostEditor(post = null) {
    this.currentPost = post;
    document.getElementById('posts-list-view').style.display = 'none';
    document.getElementById('post-editor-view').style.display = 'block';
    
    // Reset form
    document.getElementById('post-form').reset();
    
    if (post) {
      document.getElementById('post-id').value = post.id || '';
      document.getElementById('post-title').value = post.title || '';
      document.getElementById('post-slug').value = post.slug || '';
      document.getElementById('post-content').value = post.content || '';
      document.getElementById('post-excerpt').value = post.excerpt || '';
      document.getElementById('post-draft').checked = post.status === 'draft';
    }
  },
  
  showPostsList() {
    this.currentPost = null;
    document.getElementById('posts-list-view').style.display = 'block';
    document.getElementById('post-editor-view').style.display = 'none';
  },
  
  async editPost(postId) {
    if (!window.AppState.currentSite) return;
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/posts`);
      const data = await res.json();
      const post = (data.posts || []).find(p => p.id === postId);
      
      if (post) {
        this.showPostEditor(post);
      }
    } catch (error) {
      alert('Failed to load post: ' + error.message);
    }
  },
  
  async savePost(e) {
    e.preventDefault();
    
    if (!window.AppState.currentSite) return;
    
    const post = {
      id: document.getElementById('post-id').value || undefined,
      title: document.getElementById('post-title').value.trim(),
      slug: document.getElementById('post-slug').value.trim(),
      content: document.getElementById('post-content').value.trim(),
      excerpt: document.getElementById('post-excerpt').value.trim(),
      status: document.getElementById('post-draft').checked ? 'draft' : 'published',
      date: new Date().toISOString()
    };
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/posts/create`, {
        method: 'POST',
        body: JSON.stringify(post)
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save post');
      }
      
      alert('Post saved successfully!');
      this.showPostsList();
      this.loadPosts();
      
    } catch (error) {
      alert('Failed to save post: ' + error.message);
    }
  },
  
  async deletePost(postId) {
    if (!window.AppState.currentSite) return;
    
    if (!confirm('Delete this post?')) return;
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/posts/${postId}/delete`, {
        method: 'POST'
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete post');
      }
      
      alert('Post deleted successfully!');
      this.loadPosts();
      
    } catch (error) {
      alert('Failed to delete post: ' + error.message);
    }
  },
  
  // Petitions Management
  async loadPetitions() {
    if (!window.AppState.currentSite) return;
    
    const tbody = document.getElementById('petitions-list-body');
    if (!tbody) return;
    
    tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">Loading petitions...</td></tr>';
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/petitions`);
      const data = await res.json();
      
      const petitions = data.petitions || [];
      
      if (petitions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="loading-cell">No petitions found</td></tr>';
        return;
      }
      
      tbody.innerHTML = petitions.map(petition => `
        <tr>
          <td>${this.escapeHtml(petition.name || 'N/A')}</td>
          <td>${this.escapeHtml(petition.title || 'Untitled')}</td>
          <td>${petition.signatures || 0}</td>
          <td><span class="status-badge ${petition.active ? 'active' : 'inactive'}">${petition.active ? 'active' : 'inactive'}</span></td>
          <td>
            <button class="action-btn" onclick="window.contentModule.editPetition('${petition.name}')">Edit</button>
            <button class="action-btn delete" onclick="window.contentModule.deletePetition('${petition.name}')">Delete</button>
          </td>
        </tr>
      `).join('');
      
    } catch (error) {
      console.error('Failed to load petitions:', error);
      tbody.innerHTML = `<tr><td colspan="5" class="loading-cell">Error: ${error.message}</td></tr>`;
    }
  },
  
  showPetitionEditor(petition = null) {
    this.currentPetition = petition;
    document.getElementById('petitions-list-view').style.display = 'none';
    document.getElementById('petition-editor-view').style.display = 'block';
    
    // Reset form
    document.getElementById('petition-form').reset();
    
    if (petition) {
      document.getElementById('petition-id').value = petition.name || '';
      document.getElementById('petition-name').value = petition.name || '';
      document.getElementById('petition-title').value = petition.title || '';
      document.getElementById('petition-description').value = petition.description || '';
      document.getElementById('petition-message').value = petition.message || '';
      document.getElementById('petition-active').checked = petition.active || false;
      document.getElementById('petition-draft').checked = petition.status === 'draft';
    }
  },
  
  showPetitionsList() {
    this.currentPetition = null;
    document.getElementById('petitions-list-view').style.display = 'block';
    document.getElementById('petition-editor-view').style.display = 'none';
  },
  
  async editPetition(petitionName) {
    if (!window.AppState.currentSite) return;
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/petitions`);
      const data = await res.json();
      const petition = (data.petitions || []).find(p => p.name === petitionName);
      
      if (petition) {
        this.showPetitionEditor(petition);
      }
    } catch (error) {
      alert('Failed to load petition: ' + error.message);
    }
  },
  
  async savePetition(e) {
    e.preventDefault();
    
    if (!window.AppState.currentSite) return;
    
    const petition = {
      name: document.getElementById('petition-name').value.trim(),
      title: document.getElementById('petition-title').value.trim(),
      description: document.getElementById('petition-description').value.trim(),
      message: document.getElementById('petition-message').value.trim(),
      active: document.getElementById('petition-active').checked,
      status: document.getElementById('petition-draft').checked ? 'draft' : 'published'
    };
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/petitions/create`, {
        method: 'POST',
        body: JSON.stringify(petition)
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save petition');
      }
      
      alert('Petition saved successfully!');
      this.showPetitionsList();
      this.loadPetitions();
      
    } catch (error) {
      alert('Failed to save petition: ' + error.message);
    }
  },
  
  async deletePetition(petitionName) {
    if (!window.AppState.currentSite) return;
    
    if (!confirm('Delete this petition?')) return;
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/petitions/${petitionName}/delete`, {
        method: 'POST'
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to delete petition');
      }
      
      alert('Petition deleted successfully!');
      this.loadPetitions();
      
    } catch (error) {
      alert('Failed to delete petition: ' + error.message);
    }
  },
  
  // Banner Settings
  async loadBannerSettings() {
    if (!window.AppState.currentSite) return;
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/banner-settings`);
      const data = await res.json();
      
      if (data.banner) {
        document.getElementById('banner-text').value = data.banner.text || '';
        document.getElementById('banner-link').value = data.banner.link || '';
        document.getElementById('banner-enabled').checked = data.banner.enabled || false;
      }
    } catch (error) {
      console.log('Failed to load banner settings:', error.message);
    }
  },
  
  async saveBannerSettings(e) {
    e.preventDefault();
    
    if (!window.AppState.currentSite) return;
    
    const banner = {
      text: document.getElementById('banner-text').value.trim(),
      link: document.getElementById('banner-link').value.trim(),
      enabled: document.getElementById('banner-enabled').checked
    };
    
    const messageDiv = document.getElementById('banner-message');
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/cms/banner-settings`, {
        method: 'POST',
        body: JSON.stringify(banner)
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to save banner settings');
      }
      
      messageDiv.textContent = 'Banner settings saved successfully!';
      messageDiv.className = 'form-message success';
      messageDiv.style.display = 'block';
      
      setTimeout(() => {
        messageDiv.style.display = 'none';
      }, 3000);
      
    } catch (error) {
      messageDiv.textContent = 'Failed to save: ' + error.message;
      messageDiv.className = 'form-message error';
      messageDiv.style.display = 'block';
    }
  },
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },
  
  onSiteChanged(site) {
    // Reset current items
    this.currentPost = null;
    this.currentPetition = null;
    
    // Show list views
    this.showPostsList();
    this.showPetitionsList();
    
    // Clear data
    const postsBody = document.getElementById('posts-list-body');
    const petitionsBody = document.getElementById('petitions-list-body');
    
    if (postsBody) {
      postsBody.innerHTML = '<tr><td colspan="4" class="loading-cell">Select a site to view posts</td></tr>';
    }
    
    if (petitionsBody) {
      petitionsBody.innerHTML = '<tr><td colspan="5" class="loading-cell">Select a site to view petitions</td></tr>';
    }
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ContentModule.init());
} else {
  ContentModule.init();
}

// Export to window
window.contentModule = ContentModule;
