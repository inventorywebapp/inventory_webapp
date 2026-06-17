/**
 * OFFLINE MODULE - Inventory Counting System
 * Handles IndexedDB storage, offline counting, and auto-sync
 * Version: 1.0.0
 */

// ============================================
// INDEXEDDB WRAPPER
// ============================================
class OfflineDB {
    constructor() {
        this.dbName = 'InventoryDB';
        this.dbVersion = 2;
        this.db = null;
        this.isReady = false;
        this.pendingSync = [];
        this.syncInProgress = false;
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            
            request.onerror = (event) => {
                console.error('❌ IndexedDB error:', event.target.error);
                reject(event.target.error);
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                this.isReady = true;
                console.log('✅ IndexedDB ready');
                
                // Check for pending sync items
                this.checkPendingSync();
                resolve(this);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                // SKUs store - for offline SKU data
                if (!db.objectStoreNames.contains('skus')) {
                    const skuStore = db.createObjectStore('skus', { keyPath: 'id' });
                    skuStore.createIndex('sku', 'sku', { unique: true });
                    skuStore.createIndex('category', 'category', { unique: false });
                    skuStore.createIndex('description', 'description', { unique: false });
                    console.log('✅ Created skus store');
                }
                
                // Pending counts store - for offline saves
                if (!db.objectStoreNames.contains('pending_counts')) {
                    const pendingStore = db.createObjectStore('pending_counts', { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    pendingStore.createIndex('sku_id', 'sku_id', { unique: false });
                    pendingStore.createIndex('synced', 'synced', { unique: false });
                    pendingStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('✅ Created pending_counts store');
                }
                
                // Sync log store
                if (!db.objectStoreNames.contains('sync_log')) {
                    const syncStore = db.createObjectStore('sync_log', { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    syncStore.createIndex('timestamp', 'timestamp', { unique: false });
                    console.log('✅ Created sync_log store');
                }
                
                // Session store
                if (!db.objectStoreNames.contains('sessions')) {
                    const sessionStore = db.createObjectStore('sessions', { 
                        keyPath: 'session_id' 
                    });
                    console.log('✅ Created sessions store');
                }
            };
        });
    }

    // ============ SKU OPERATIONS ============
    
    async saveSkus(skus) {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['skus'], 'readwrite');
            const store = transaction.objectStore('skus');
            
            // Clear existing SKUs first (for fresh sync)
            const clearRequest = store.clear();
            
            clearRequest.onsuccess = () => {
                let completed = 0;
                const total = skus.length;
                
                for (const sku of skus) {
                    const addRequest = store.add(sku);
                    addRequest.onsuccess = () => {
                        completed++;
                        if (completed === total) {
                            console.log(`✅ Saved ${total} SKUs to IndexedDB`);
                            resolve(total);
                        }
                    };
                    addRequest.onerror = (e) => {
                        console.error('Error saving SKU:', e);
                        reject(e);
                    };
                }
            };
            
            clearRequest.onerror = (e) => {
                reject(e);
            };
        });
    }

    async getAllSkus() {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['skus'], 'readonly');
            const store = transaction.objectStore('skus');
            const request = store.getAll();
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getSkuById(id) {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['skus'], 'readonly');
            const store = transaction.objectStore('skus');
            const request = store.get(id);
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async searchSkus(query) {
        if (!this.isReady) await this.init();
        
        const allSkus = await this.getAllSkus();
        const lowerQuery = query.toLowerCase();
        
        return allSkus.filter(sku => 
            sku.sku.toLowerCase().includes(lowerQuery) ||
            (sku.description && sku.description.toLowerCase().includes(lowerQuery))
        );
    }

    // ============ PENDING COUNTS OPERATIONS ============
    
    async addPendingCount(countData) {
        if (!this.isReady) await this.init();
        
        countData.timestamp = new Date().toISOString();
        countData.synced = false;
        countData.retry_count = 0;
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pending_counts'], 'readwrite');
            const store = transaction.objectStore('pending_counts');
            const request = store.add(countData);
            
            request.onsuccess = () => {
                console.log('📝 Pending count saved locally:', countData);
                resolve(request.result);
                
                // Trigger sync if online
                if (navigator.onLine) {
                    setTimeout(() => this.syncPendingCounts(), 1000);
                }
            };
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async getPendingCounts() {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pending_counts'], 'readonly');
            const store = transaction.objectStore('pending_counts');
            const index = store.index('synced');
            const request = index.getAll(0); // Get all unsynced
            
            request.onsuccess = () => {
                resolve(request.result);
            };
            request.onerror = () => {
                reject(request.error);
            };
        });
    }

    async markPendingSynced(id) {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pending_counts'], 'readwrite');
            const store = transaction.objectStore('pending_counts');
            
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (record) {
                    record.synced = true;
                    record.synced_at = new Date().toISOString();
                    const putRequest = store.put(record);
                    putRequest.onsuccess = () => resolve(true);
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    resolve(false);
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async deletePendingCount(id) {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pending_counts'], 'readwrite');
            const store = transaction.objectStore('pending_counts');
            const request = store.delete(id);
            
            request.onsuccess = () => resolve(true);
            request.onerror = () => reject(request.error);
        });
    }

    // ============ SYNC OPERATIONS ============
    
    async checkPendingSync() {
        try {
            const pending = await this.getPendingCounts();
            if (pending.length > 0) {
                console.log(`📤 ${pending.length} pending counts to sync`);
                this.pendingSync = pending;
                
                // Update UI indicator
                this.updateSyncIndicator(pending.length);
                
                // Auto-sync if online
                if (navigator.onLine) {
                    setTimeout(() => this.syncPendingCounts(), 2000);
                }
            }
        } catch (error) {
            console.error('Error checking pending sync:', error);
        }
    }

    async syncPendingCounts() {
        if (this.syncInProgress) {
            console.log('⏳ Sync already in progress');
            return;
        }
        
        if (!navigator.onLine) {
            console.log('📶 Offline - sync deferred');
            return;
        }
        
        const pending = await this.getPendingCounts();
        if (pending.length === 0) {
            console.log('✅ No pending counts to sync');
            this.updateSyncIndicator(0);
            return;
        }
        
        this.syncInProgress = true;
        console.log(`🔄 Syncing ${pending.length} pending counts...`);
        this.updateSyncStatus('syncing', pending.length);
        
        let successCount = 0;
        let failCount = 0;
        
        for (const record of pending) {
            try {
                const response = await fetch('/api/sync_offline_counts', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        sku_id: record.sku_id,
                        count: record.count,
                        session_id: record.session_id,
                        timestamp: record.timestamp
                    })
                });
                
                if (response.ok) {
                    const data = await response.json();
                    if (data.success) {
                        await this.markPendingSynced(record.id);
                        successCount++;
                        console.log(`✅ Synced SKU ${record.sku_id}`);
                    } else {
                        failCount++;
                        console.warn(`⚠️ Sync failed for SKU ${record.sku_id}:`, data.message);
                    }
                } else {
                    failCount++;
                    record.retry_count = (record.retry_count || 0) + 1;
                    await this.updatePendingRetry(record.id, record.retry_count);
                }
            } catch (error) {
                console.error(`❌ Sync error for SKU ${record.sku_id}:`, error);
                failCount++;
                record.retry_count = (record.retry_count || 0) + 1;
                await this.updatePendingRetry(record.id, record.retry_count);
            }
        }
        
        this.syncInProgress = false;
        
        // Log sync completion
        this.addSyncLog({
            success_count: successCount,
            fail_count: failCount,
            total: pending.length,
            timestamp: new Date().toISOString()
        });
        
        console.log(`✅ Sync complete: ${successCount} success, ${failCount} failed`);
        this.updateSyncIndicator(await this.getPendingCounts().then(p => p.length));
        
        if (failCount > 0) {
            this.updateSyncStatus('partial', failCount);
        } else {
            this.updateSyncStatus('complete', successCount);
        }
    }

    async updatePendingRetry(id, retryCount) {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pending_counts'], 'readwrite');
            const store = transaction.objectStore('pending_counts');
            
            const getRequest = store.get(id);
            getRequest.onsuccess = () => {
                const record = getRequest.result;
                if (record) {
                    record.retry_count = retryCount;
                    const putRequest = store.put(record);
                    putRequest.onsuccess = () => resolve(true);
                    putRequest.onerror = () => reject(putRequest.error);
                } else {
                    resolve(false);
                }
            };
            getRequest.onerror = () => reject(getRequest.error);
        });
    }

    async addSyncLog(logData) {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sync_log'], 'readwrite');
            const store = transaction.objectStore('sync_log');
            const request = store.add(logData);
            
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async getSyncLogs(limit = 10) {
        if (!this.isReady) await this.init();
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['sync_log'], 'readonly');
            const store = transaction.objectStore('sync_log');
            const index = store.index('timestamp');
            const request = index.openCursor(null, 'prev');
            
            const results = [];
            let count = 0;
            
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor && count < limit) {
                    results.push(cursor.value);
                    count++;
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    // ============ UI UPDATE HELPERS ============
    
    updateSyncIndicator(count) {
        const indicator = document.getElementById('offline-indicator');
        if (!indicator) return;
        
        const badge = indicator.querySelector('.pending-badge');
        if (badge) {
            if (count > 0) {
                badge.textContent = count;
                badge.style.display = 'inline-block';
                indicator.querySelector('.offline-text').textContent = 
                    `${count} pending sync`;
                indicator.querySelector('.offline-icon').className = 'bi bi-cloud-arrow-up';
            } else {
                badge.style.display = 'none';
                indicator.querySelector('.offline-text').textContent = 'Synced';
                indicator.querySelector('.offline-icon').className = 'bi bi-cloud-check';
            }
        }
    }

    updateSyncStatus(status, count) {
        const indicator = document.getElementById('offline-indicator');
        if (!indicator) return;
        
        const statusText = indicator.querySelector('.sync-status');
        if (!statusText) return;
        
        switch(status) {
            case 'syncing':
                statusText.textContent = `Syncing ${count} items...`;
                statusText.className = 'sync-status text-warning';
                break;
            case 'complete':
                statusText.textContent = `✅ Synced ${count} items`;
                statusText.className = 'sync-status text-success';
                setTimeout(() => {
                    statusText.textContent = 'All synced';
                }, 3000);
                break;
            case 'partial':
                statusText.textContent = `⚠️ ${count} items failed`;
                statusText.className = 'sync-status text-danger';
                break;
            default:
                statusText.textContent = '';
        }
    }

    // ============ CLEANUP ============
    
    async cleanupOldRecords(days = 30) {
        if (!this.isReady) await this.init();
        
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['pending_counts', 'sync_log'], 'readwrite');
            
            // Clean pending_counts (only synced and older than cutoff)
            const pendingStore = transaction.objectStore('pending_counts');
            const pendingIndex = pendingStore.index('synced');
            const pendingRequest = pendingIndex.getAll(1); // Get all synced
            
            pendingRequest.onsuccess = () => {
                let deleted = 0;
                const records = pendingRequest.result;
                for (const record of records) {
                    if (new Date(record.timestamp) < cutoff) {
                        pendingStore.delete(record.id);
                        deleted++;
                    }
                }
                
                // Clean sync_log
                const syncStore = transaction.objectStore('sync_log');
                const syncIndex = syncStore.index('timestamp');
                const syncRequest = syncIndex.openCursor();
                
                syncRequest.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        if (new Date(cursor.value.timestamp) < cutoff) {
                            cursor.delete();
                        }
                        cursor.continue();
                    }
                };
                
                console.log(`🧹 Cleaned up ${deleted} old records`);
                resolve(deleted);
            };
            
            pendingRequest.onerror = () => reject(pendingRequest.error);
        });
    }

    // ============ GET DB STATUS ============
    
    async getStatus() {
        if (!this.isReady) await this.init();
        
        const skuCount = await this.getAllSkus().then(s => s.length);
        const pendingCount = await this.getPendingCounts().then(p => p.length);
        
        return {
            isReady: this.isReady,
            skuCount: skuCount,
            pendingCount: pendingCount,
            dbName: this.dbName,
            dbVersion: this.dbVersion
        };
    }
}

// ============================================
// OFFLINE MANAGER - Singleton
// ============================================
class OfflineManager {
    constructor() {
        this.db = new OfflineDB();
        this.isOnline = navigator.onLine;
        this.isInitialized = false;
        this.listeners = [];
    }

    async init() {
        if (this.isInitialized) return;
        
        await this.db.init();
        this.isInitialized = true;
        
        // Setup online/offline listeners
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
        
        // Initial sync check
        if (this.isOnline) {
            await this.db.syncPendingCounts();
        }
        
        this.showStatus();
        console.log('✅ OfflineManager initialized');
    }

    handleOnline() {
        this.isOnline = true;
        console.log('🟢 Online - syncing pending counts...');
        this.showStatus();
        this.db.syncPendingCounts();
        this.notifyListeners('online');
    }

    handleOffline() {
        this.isOnline = false;
        console.log('🔴 Offline - working in offline mode');
        this.showStatus();
        this.notifyListeners('offline');
    }

    showStatus() {
        const indicator = document.getElementById('offline-indicator');
        if (!indicator) return;
        
        const statusIcon = indicator.querySelector('.offline-icon');
        const statusText = indicator.querySelector('.offline-text');
        
        if (this.isOnline) {
            statusIcon.className = 'bi bi-wifi';
            statusText.textContent = 'Online';
            indicator.className = 'offline-indicator online';
        } else {
            statusIcon.className = 'bi bi-wifi-off';
            statusText.textContent = 'Offline Mode';
            indicator.className = 'offline-indicator offline';
        }
    }

    async saveCountOffline(skuId, count, sessionId) {
        if (!this.isInitialized) await this.init();
        
        const countData = {
            sku_id: skuId,
            count: count,
            session_id: sessionId,
            timestamp: new Date().toISOString()
        };
        
        if (!this.isOnline) {
            // Save offline
            await this.db.addPendingCount(countData);
            this.updatePendingUI(await this.db.getPendingCounts());
            return { success: true, offline: true };
        } else {
            // Try online first
            try {
                const response = await fetch('/api/save_count', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(countData)
                });
                
                if (response.ok) {
                    return { success: true, offline: false };
                }
            } catch (error) {
                console.warn('Online save failed, falling back to offline:', error);
            }
            
            // Fallback to offline
            await this.db.addPendingCount(countData);
            this.updatePendingUI(await this.db.getPendingCounts());
            return { success: true, offline: true };
        }
    }

    async getSkus() {
        if (!this.isInitialized) await this.init();
        
        // Try to get from IndexedDB first
        const cachedSkus = await this.db.getAllSkus();
        if (cachedSkus.length > 0) {
            console.log(`📦 Using ${cachedSkus.length} cached SKUs`);
            return cachedSkus;
        }
        
        // If no cache, fetch from server
        if (this.isOnline) {
            try {
                const response = await fetch('/api/get_all_skus');
                const skus = await response.json();
                await this.db.saveSkus(skus);
                console.log(`📥 Fetched and cached ${skus.length} SKUs`);
                return skus;
            } catch (error) {
                console.error('Failed to fetch SKUs:', error);
                return [];
            }
        }
        
        return [];
    }

    updatePendingUI(pendingCounts) {
        this.db.updateSyncIndicator(pendingCounts.length);
        
        // Also update any custom UI
        const pendingBadge = document.getElementById('pending-count-badge');
        if (pendingBadge) {
            pendingBadge.textContent = pendingCounts.length;
            pendingBadge.style.display = pendingCounts.length > 0 ? 'inline-block' : 'none';
        }
    }

    addListener(callback) {
        this.listeners.push(callback);
    }

    notifyListeners(event) {
        for (const listener of this.listeners) {
            listener(event, this.isOnline);
        }
    }

    async getStatus() {
        if (!this.isInitialized) await this.init();
        return {
            isOnline: this.isOnline,
            isInitialized: this.isInitialized,
            dbStatus: await this.db.getStatus()
        };
    }
}

// ============================================
// GLOBAL INSTANCE
// ============================================
const offlineManager = new OfflineManager();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    await offlineManager.init();
});

// Export for use in main.js
window.offlineManager = offlineManager;
window.OfflineDB = OfflineDB;
