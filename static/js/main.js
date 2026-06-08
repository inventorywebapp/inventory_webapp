// Global utility functions
function formatDateTime(date) {
    return new Date(date).toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

function showLoading() {
    $('#loadingOverlay').show();
}

function hideLoading() {
    $('#loadingOverlay').hide();
}

function showNotification(message, type = 'success') {
    const alert = $(`<div class="alert alert-${type} alert-dismissible fade show" role="alert">
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    </div>`);
    $('.container').prepend(alert);
    setTimeout(() => alert.alert('close'), 3000);
}

// Auto-save functionality (optional)
let autoSaveTimer = null;
function startAutoSave(saveFunction, interval = 30000) {
    if (autoSaveTimer) clearInterval(autoSaveTimer);
    autoSaveTimer = setInterval(saveFunction, interval);
}

function stopAutoSave() {
    if (autoSaveTimer) {
        clearInterval(autoSaveTimer);
        autoSaveTimer = null;
    }
}

// Form validation
function validateCount(count) {
    const num = parseFloat(count);
    if (isNaN(num)) return 0;
    return Math.max(0, num);
}

// Keyboard shortcuts
$(document).keydown(function(e) {
    // Ctrl+S to save
    if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        if (typeof saveAllCounts === 'function') {
            saveAllCounts();
        }
    }
    // F5 to refresh
    if (e.key === 'F5') {
        e.preventDefault();
        if (typeof loadSkus === 'function') {
            loadSkus();
        }
    }
});

// Service Worker for offline support (PWA)
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').then(function(registration) {
        console.log('Service Worker registered successfully:', registration);
    }).catch(function(error) {
        console.log('Service Worker registration failed:', error);
    });
}