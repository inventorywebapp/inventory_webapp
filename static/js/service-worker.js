/**
 * Service Worker - Inventory Counting System
 * Provides offline support and asset caching
 * Version: 1.0.0
 */

const CACHE_VERSION = 'v2';
const CACHE_NAME = `inventory-app-${CACHE_VERSION}`;
const API_CACHE_NAME = `inventory-api-${CACHE_VERSION}`;

// Assets to cache on install
const STATIC_ASSETS = [
    '/',
    '/static/css/style.css',
    '/static/js/main.js',
    '/static/js/offline.js',
    '/manifest.json',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/css/bootstrap.min.css',
    'https://cdn.jsdelivr.net/npm/bootstrap-icons@1.8.1/font/bootstrap-icons.css',
    'https://cdn.jsdelivr.net/npm/bootstrap@5.1.3/dist/js/bootstrap.bundle.min.js',
    'https://code.jquery.com/jquery-3.6.0.min.js',
    'https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js',
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap'
];

// API endpoints to cache (GET requests only)
const API_ENDPOINTS = [
    '/api/get_all_skus',
    '/api/active_session',
    '/api/sync_offline_counts'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    console.log(`[SW] Installing ${CACHE_NAME}`);
    
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('[SW] Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
            .then(() => {
                console.log('[SW] Assets cached successfully');
                return self.skipWaiting();
            })
            .catch((error) => {
                console.error('[SW] Cache error:', error);
            })
    );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    console.log(`[SW] Activating ${CACHE_NAME}`);
    
    const cacheWhitelist = [CACHE_NAME, API_CACHE_NAME];
    
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames.map((cacheName) => {
                    if (!cacheWhitelist.includes(cacheName)) {
                        console.log(`[SW] Deleting old cache: ${cacheName}`);
                        return caches.delete(cacheName);
                    }
                })
            );
        })
        .then(() => {
            console.log('[SW] Claiming clients');
            return self.clients.claim();
        })
    );
});

// Fetch event - intercept requests
self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return event.respondWith(fetch(request));
    }
    
    // Skip browser extensions and analytics
    if (url.pathname.startsWith('/chrome-extension') || 
        url.pathname.includes('google-analytics')) {
        return event.respondWith(fetch(request));
    }
    
    // API requests - Network First with cache fallback
    if (url.pathname.startsWith('/api/')) {
        return event.respondWith(handleApiRequest(request));
    }
    
    // HTML pages - Network First
    if (url.pathname.endsWith('.html') || url.pathname === '/') {
        return event.respondWith(handlePageRequest(request));
    }
    
    // Static assets - Cache First (Stale-While-Revalidate)
    if (STATIC_ASSETS.some(asset => url.pathname.includes(asset) || url.href.includes(asset))) {
        return event.respondWith(handleStaticAsset(request));
    }
    
    // Default - Network First with cache fallback
    return event.respondWith(handleDefaultRequest(request));
});

// ============ REQUEST HANDLERS ============

async function handleApiRequest(request) {
    try {
        // Try network first
        const response = await fetch(request);
        
        // Cache successful GET responses
        if (response.ok && request.method === 'GET') {
            const cache = await caches.open(API_CACHE_NAME);
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        // Network failed, try cache
        console.log(`[SW] API request failed, checking cache: ${request.url}`);
        const cached = await caches.match(request);
        if (cached) {
            return cached;
        }
        
        // Return error response
        return new Response(
            JSON.stringify({ 
                error: 'Offline', 
                message: 'You are offline. Please connect to the internet to sync data.' 
            }),
            {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

async function handlePageRequest(request) {
    try {
        // Try network first
        const response = await fetch(request);
        
        // Cache the response
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
        
        return response;
    } catch (error) {
        // Network failed, try cache
        const cached = await caches.match(request);
        if (cached) {
            return cached;
        }
        
        // Return offline page
        return new Response(
            `
            <!DOCTYPE html>
            <html>
            <head><title>Offline</title></head>
            <body style="font-family: system-ui; text-align: center; padding: 40px; background: #f5f5f5;">
                <h1 style="color: #0d6efd;">📶 Offline</h1>
                <p>You are currently offline. Please connect to the internet to access this page.</p>
                <p><a href="/" style="color: #0d6efd;">Go to Home</a></p>
            </body>
            </html>
            `,
            {
                status: 503,
                statusText: 'Offline',
                headers: { 'Content-Type': 'text/html' }
            }
        );
    }
}

async function handleStaticAsset(request) {
    // Try cache first
    const cached = await caches.match(request);
    if (cached) {
        // Revalidate in background
        fetch(request).then(response => {
            if (response.ok) {
                caches.open(CACHE_NAME).then(cache => {
                    cache.put(request, response);
                });
            }
        }).catch(() => {});
        
        return cached;
    }
    
    // Not in cache, try network
    try {
        const response = await fetch(request);
        const cache = await caches.open(CACHE_NAME);
        cache.put(request, response.clone());
        return response;
    } catch (error) {
        return new Response('Asset not available offline', { status: 404 });
    }
}

async function handleDefaultRequest(request) {
    try {
        const response = await fetch(request);
        
        // Cache static assets
        if (request.url.includes('.css') || 
            request.url.includes('.js') || 
            request.url.includes('.png') || 
            request.url.includes('.jpg') || 
            request.url.includes('.ico')) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
        }
        
        return response;
    } catch (error) {
        const cached = await caches.match(request);
        if (cached) {
            return cached;
        }
        
        return new Response('Resource not available offline', { status: 404 });
    }
}

// ============ BACKGROUND SYNC ============

// Listen for sync events
self.addEventListener('sync', (event) => {
    if (event.tag === 'sync-pending-counts') {
        event.waitUntil(syncPendingCounts());
    }
});

async function syncPendingCounts() {
    try {
        // Get all clients
        const clients = await self.clients.matchAll({
            includeUncontrolled: true,
            type: 'window'
        });
        
        // Send message to clients to trigger sync
        for (const client of clients) {
            client.postMessage({
                type: 'SYNC_TRIGGERED',
                timestamp: new Date().toISOString()
            });
        }
        
        console.log('[SW] Sync triggered for all clients');
        return true;
    } catch (error) {
        console.error('[SW] Sync error:', error);
        return false;
    }
}

// ============ PUSH NOTIFICATIONS (Optional) ============

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data.json();
    } catch {
        data = { title: 'Inventory Alert', message: 'New update available' };
    }
    
    const options = {
        body: data.message || 'Please sync your counts',
        icon: '/static/icons/icon-192x192.png',
        badge: '/static/icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        data: {
            url: data.url || '/counting'
        }
    };
    
    event.waitUntil(
        self.registration.showNotification(
            data.title || 'Inventory System',
            options
        )
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    
    const url = event.notification.data?.url || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then((clientList) => {
                for (const client of clientList) {
                    if (client.url === url && 'focus' in client) {
                        return client.focus();
                    }
                }
                return self.clients.openWindow(url);
            })
    );
});
