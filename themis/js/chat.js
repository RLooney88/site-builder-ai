// Themis - AI Chat Interface Module

const ChatModule = {
  isLoading: false,
  chatAttachments: [],
  messageInput: null,
  
  init() {
    this.messageInput = document.getElementById('message-input');
    this.setupEventListeners();
  },
  
  setupEventListeners() {
    // Auto-resize textarea
    if (this.messageInput) {
      this.messageInput.addEventListener('input', () => {
        this.messageInput.style.height = 'auto';
        this.messageInput.style.height = this.messageInput.scrollHeight + 'px';
      });
      
      // Enter to send (Shift+Enter for new line)
      this.messageInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });
      
      // Paste handler for images
      this.messageInput.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        
        for (const item of items) {
          if (item.type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              this.handleChatAttachment(file);
            }
            break;
          }
        }
      });
      
      // Drag and drop on textarea
      const inputArea = document.getElementById('input-area');
      const dropOverlay = document.getElementById('drop-overlay');
      
      if (inputArea && dropOverlay) {
        inputArea.addEventListener('dragover', (e) => {
          e.preventDefault();
          dropOverlay.classList.add('active');
        });
        
        inputArea.addEventListener('dragleave', () => {
          dropOverlay.classList.remove('active');
        });
        
        inputArea.addEventListener('drop', (e) => {
          e.preventDefault();
          dropOverlay.classList.remove('active');
          
          const files = e.dataTransfer?.files;
          if (files && files.length > 0) {
            const imageFile = Array.from(files).find(f => f.type.startsWith('image/'));
            if (imageFile) {
              this.handleChatAttachment(imageFile);
            }
          }
        });
      }
    }
    
    // Send button
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
      sendBtn.addEventListener('click', () => this.sendMessage());
    }
    
    // Attach button
    const attachBtn = document.getElementById('attach-btn');
    const chatFileInput = document.getElementById('chat-file-input');
    
    if (attachBtn && chatFileInput) {
      attachBtn.addEventListener('click', () => {
        chatFileInput.click();
      });
      
      chatFileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.handleChatAttachment(e.target.files[0]);
        }
      });
    }
  },
  
  handleChatAttachment(file) {
    if (!file.type.startsWith('image/')) {
      alert('Please attach an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      alert('Image must be under 5MB');
      return;
    }
    
    const attachment = {
      id: Date.now(),
      file: file,
      preview: URL.createObjectURL(file)
    };
    
    this.chatAttachments.push(attachment);
    this.renderChatAttachments();
  },
  
  renderChatAttachments() {
    const container = document.getElementById('chat-attachments');
    if (!container) return;
    
    container.innerHTML = this.chatAttachments.map(att => `
      <div class="chat-attachment-preview">
        <img src="${att.preview}" alt="Attachment">
        <button class="remove-attachment" onclick="window.chatModule.removeChatAttachment(${att.id})">×</button>
      </div>
    `).join('');
  },
  
  removeChatAttachment(id) {
    const att = this.chatAttachments.find(a => a.id === id);
    if (att) {
      URL.revokeObjectURL(att.preview);
      this.chatAttachments = this.chatAttachments.filter(a => a.id !== id);
      this.renderChatAttachments();
    }
  },
  
  async sendMessage() {
    if (!window.AppState.currentSite) {
      alert('Please select a site first');
      return;
    }
    
    const message = this.messageInput.value.trim();
    
    if ((!message && this.chatAttachments.length === 0) || this.isLoading) {
      return;
    }
    
    // Upload images first if any attachments
    let imageUrls = [];
    if (this.chatAttachments.length > 0) {
      for (const att of this.chatAttachments) {
        try {
          const formData = new FormData();
          formData.append('file', att.file);
          formData.append('context', 'chat');
          
          const res = await fetch(`${window.THEMIS_CONFIG.apiBase}/sites/${window.AppState.currentSite.id}/upload`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${window.AppState.token}`
            },
            body: formData
          });
          
          const data = await res.json();
          if (data.success && data.url) {
            const fullUrl = `${window.THEMIS_CONFIG.apiBase}${data.url}`;
            imageUrls.push(fullUrl);
          }
        } catch (err) {
          console.error('Image upload error:', err);
        }
      }
      
      // Clear attachments after upload
      this.chatAttachments.forEach(att => URL.revokeObjectURL(att.preview));
      this.chatAttachments = [];
      this.renderChatAttachments();
    }
    
    // Clear input
    this.messageInput.value = '';
    this.messageInput.style.height = 'auto';
    
    // Remove empty state
    const emptyState = document.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    // Add user message
    this.addMessage('user', message);
    
    // Show images in the message if any
    if (imageUrls.length > 0) {
      const lastMsg = document.querySelector('.message.user:last-child .message-content');
      imageUrls.forEach(url => {
        const img = document.createElement('img');
        img.src = url;
        lastMsg.appendChild(img);
      });
    }
    
    // Show loading
    this.isLoading = true;
    const sendBtn = document.getElementById('send-btn');
    sendBtn.disabled = true;
    sendBtn.innerHTML = '<span class="loading"></span>';
    
    // Add a status message that we'll update in real-time
    const statusId = 'status-' + Date.now();
    this.addMessage('assistant', `<span class="ai-status" id="${statusId}">Thinking...</span>`, true);
    const statusEl = document.getElementById(statusId);
    
    try {
      // Use SSE streaming for live status updates
      const res = await fetch(`${window.THEMIS_CONFIG.apiBase}/sites/${window.AppState.currentSite.id}/chat?stream=true`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'Authorization': `Bearer ${window.AppState.token}`
        },
        body: JSON.stringify({
          message,
          images: imageUrls.length > 0 ? imageUrls : undefined
        })
      });
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(errData.error || 'Request failed');
      }
      
      // Read the SSE stream
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let finalMessage = '';
      let buffer = '';
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep incomplete line in buffer
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));
              if (event.type === 'status') {
                // Tool activity — show as spinner status
                if (statusEl) statusEl.textContent = event.status;
              } else if (event.type === 'progress') {
                // AI's intermediate text — show as status (first ~80 chars)
                if (statusEl) {
                  const short = event.text.length > 80 ? event.text.slice(0, 80) + '...' : event.text;
                  statusEl.textContent = short;
                }
              } else if (event.type === 'done') {
                finalMessage = event.message;
              }
            } catch (e) {
              console.error('SSE parse error:', e);
            }
          }
        }
      }
      
      // Replace status message with final response
      const statusMsg = statusEl?.closest('.message');
      if (statusMsg) statusMsg.remove();
      
      if (finalMessage) {
        this.addMessage('assistant', finalMessage);
      } else {
        this.addMessage('assistant', 'Something went wrong — no response received. Try again?');
      }
      
    } catch (error) {
      console.error('Error:', error);
      const statusMsg = statusEl?.closest('.message');
      if (statusMsg) statusMsg.remove();
      this.addMessage('assistant', `Error: ${error.message}`);
    } finally {
      this.isLoading = false;
      sendBtn.disabled = false;
      sendBtn.textContent = 'Send';
    }
  },
  
  addMessage(role, content, useHTML = false) {
    const messages = document.getElementById('messages');
    if (!messages) return;
    
    const message = document.createElement('div');
    message.className = `message ${role}`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = role === 'user' ? 'You' : 'AI';
    
    const messageContent = document.createElement('div');
    messageContent.className = 'message-content';
    if (useHTML) {
      messageContent.innerHTML = content;
    } else {
      messageContent.textContent = content;
    }
    
    message.appendChild(avatar);
    message.appendChild(messageContent);
    
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
  },
  
  async loadHistory() {
    if (!window.AppState.currentSite) return;
    
    try {
      const res = await window.apiRequest(`/sites/${window.AppState.currentSite.id}/history`);
      const data = await res.json();
      
      if (data.messages && data.messages.length > 0) {
        const emptyState = document.querySelector('.empty-state');
        if (emptyState) emptyState.remove();
        
        const messages = document.getElementById('messages');
        if (messages) {
          messages.innerHTML = '';
          data.messages.forEach(msg => {
            this.addMessage(msg.role, msg.content);
          });
        }
      }
    } catch (error) {
      console.log('No history loaded:', error.message);
    }
  },
  
  onSiteChanged(site) {
    // Clear messages and load history for new site
    const messages = document.getElementById('messages');
    if (messages) {
      messages.innerHTML = `
        <div class="empty-state">
          <h2>Welcome to AI Editor</h2>
          <p>Ask me to edit your site, add new pages, update content, or make design changes.</p>
        </div>
      `;
    }
    
    this.loadHistory();
  }
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => ChatModule.init());
} else {
  ChatModule.init();
}

// Export to window
window.chatModule = ChatModule;
