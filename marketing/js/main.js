// ====================================
// THEMIS MARKETING SITE - JAVASCRIPT
// ====================================

document.addEventListener('DOMContentLoaded', function() {
    
    // ===== MOBILE NAVIGATION TOGGLE =====
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    const navLinks = document.querySelectorAll('.nav-link');
    
    // Toggle mobile menu
    navToggle.addEventListener('click', function() {
        navMenu.classList.toggle('active');
        
        // Animate hamburger icon
        const spans = navToggle.querySelectorAll('span');
        if (navMenu.classList.contains('active')) {
            spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
            spans[1].style.opacity = '0';
            spans[2].style.transform = 'rotate(-45deg) translate(7px, -6px)';
        } else {
            spans[0].style.transform = 'none';
            spans[1].style.opacity = '1';
            spans[2].style.transform = 'none';
        }
    });
    
    // Close mobile menu when a link is clicked
    navLinks.forEach(link => {
        link.addEventListener('click', function() {
            if (navMenu.classList.contains('active')) {
                navMenu.classList.remove('active');
                const spans = navToggle.querySelectorAll('span');
                spans[0].style.transform = 'none';
                spans[1].style.opacity = '1';
                spans[2].style.transform = 'none';
            }
        });
    });
    
    
    // ===== SMOOTH SCROLLING FOR ANCHOR LINKS =====
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            
            // Skip if href is just "#" (empty)
            if (href === '#') {
                e.preventDefault();
                return;
            }
            
            const target = document.querySelector(href);
            
            if (target) {
                e.preventDefault();
                
                const navHeight = document.querySelector('.nav').offsetHeight;
                const targetPosition = target.getBoundingClientRect().top + window.pageYOffset - navHeight;
                
                window.scrollTo({
                    top: targetPosition,
                    behavior: 'smooth'
                });
            }
        });
    });
    
    
    // ===== SCROLL ANIMATIONS (FADE IN) =====
    const fadeElements = document.querySelectorAll('.fade-in');
    
    const fadeInObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });
    
    fadeElements.forEach(element => {
        fadeInObserver.observe(element);
    });
    
    
    // ===== STICKY NAV SHADOW ON SCROLL =====
    const nav = document.getElementById('nav');
    
    window.addEventListener('scroll', function() {
        if (window.scrollY > 50) {
            nav.classList.add('scrolled');
        } else {
            nav.classList.remove('scrolled');
        }
    });
    
    
    // ===== PRICING CTA TRACKING (Optional Analytics Hook) =====
    const pricingButtons = document.querySelectorAll('.pricing-card .btn');
    
    pricingButtons.forEach((button, index) => {
        button.addEventListener('click', function(e) {
            // Hook for analytics (Google Analytics, Mixpanel, etc.)
            const tier = this.closest('.pricing-card').querySelector('.pricing-tier').textContent;
            console.log(`Pricing CTA clicked: ${tier}`);
            
            // You can add analytics tracking here
            // Example: gtag('event', 'pricing_cta_click', { tier: tier });
        });
    });
    
    
    // ===== MOCKUP CHAT ANIMATION (Optional Enhancement) =====
    // Animate the mockup chat messages on page load
    const chatMessages = document.querySelectorAll('.chat-message');
    
    if (chatMessages.length > 0) {
        chatMessages.forEach((message, index) => {
            message.style.opacity = '0';
            message.style.transform = 'translateY(20px)';
            
            setTimeout(() => {
                message.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
                message.style.opacity = '1';
                message.style.transform = 'translateY(0)';
            }, 500 + (index * 400));
        });
    }
    
    
    // ===== FAQ ACCORDION (Optional - currently static) =====
    // If you want to add click-to-expand functionality to FAQ items, implement here
    // For now, all FAQ answers are visible by default (better for SEO)
    
    
    // ===== FORM VALIDATION (If contact form is added) =====
    // Add form validation logic here when contact form is implemented
    
    
    // ===== CONSOLE GREETING =====
    console.log('%c🚀 Themis Marketing Site', 'font-size: 20px; font-weight: bold; color: #9834E7;');
    console.log('%cBuilt with ❤️ by Pantheon Technologies', 'font-size: 12px; color: #666;');
    
});


// ===== UTILITY: Debounce function for performance =====
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}


// ===== PERFORMANCE: Lazy load images when implemented =====
// When images are added, implement lazy loading here
// Example:
// if ('loading' in HTMLImageElement.prototype) {
//     const images = document.querySelectorAll('img[loading="lazy"]');
//     images.forEach(img => {
//         img.src = img.dataset.src;
//     });
// } else {
//     // Fallback for browsers that don't support lazy loading
//     // Use Intersection Observer
// }


// ===== ACCESSIBILITY: Focus management =====
// Ensure keyboard navigation works smoothly
document.addEventListener('keydown', function(e) {
    // Close mobile menu on Escape key
    if (e.key === 'Escape') {
        const navMenu = document.getElementById('navMenu');
        if (navMenu.classList.contains('active')) {
            navMenu.classList.remove('active');
            const navToggle = document.getElementById('navToggle');
            const spans = navToggle.querySelectorAll('span');
            spans[0].style.transform = 'none';
            spans[1].style.opacity = '1';
            spans[2].style.transform = 'none';
        }
    }
});
