/**
 * MAIN APPLICATION - Inventory Counting System
 * Version: 2.0 (PWA Ready)
 */

// ============================================
// GLOBAL STATE - SINGLE DECLARATION ONLY
// ============================================
// Remove the duplicate 'let allSkus = []' - use window.allSkus instead
// This prevents the "already declared" error

// Use window.allSkus for the main SKU array
// This allows offline.js to access it without redeclaring

// ============================================
// SKU LOADING
// ============================================
async function loadSkus() {
    try {
        showLoading(true);
        
        // Try to get from IndexedDB first (if available)
        if (window.offlineManager && window.offlineManager.db) {
            const cachedSkus = await window.offlineManager.db.getAllSkus();
            if (cachedSkus && cachedSkus.length > 0) {
                console.log(`📦 Using ${cachedSkus.length} cached SKUs`);
                window.allSkus = cachedSkus;
                applyFilters();
                showLoading(false);
                return true;
            }
        }
        
        // If offline, show error
        if (!navigator.onLine) {
            showToast('📶 Offline - using cached data if available', 'warning');
            showLoading(false);
            return false;
        }
        
        // Load from server
        const response = await fetch('/api/get_all_skus');
        if (!response.ok) throw new Error('Failed to fetch SKUs');
        
        window.allSkus = await response.json();
        
        // Cache for offline use
        if (window.offlineManager && window.offlineManager.db) {
            await window.offlineManager.db.saveSkus(window.allSkus);
            console.log(`💾 Cached ${window.allSkus.length} SKUs offline`);
        }
        
        applyFilters();
        showLoading(false);
        return true;
        
    } catch (error) {
        console.error('Error loading SKUs:', error);
        showToast('Error loading SKUs: ' + error.message, 'error');
        showLoading(false);
        return false;
    }
}

// ============================================
// OFFLINE COUNT SAVING
// ============================================
async function saveCountOffline(skuId, count, sessionId) {
    if (!window.offlineManager) {
        return { success: false, error: 'Offline manager not available' };
    }
    
    try {
        const countData = {
            sku_id: skuId,
            count: count,
            session_id: sessionId,
            timestamp: new Date().toISOString()
        };
        
        // Try online first if available
        if (navigator.onLine) {
            try {
                const response = await fetch('/api/save_count', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(countData)
                });
                if (response.ok) {
                    return { success: true, offline: false };
                }
            } catch (e) {
                console.warn('Online save failed, using offline:', e);
            }
        }
        
        // Save offline
        const result = await window.offlineManager.db.addPendingCount(countData);
        showToast('💾 Count saved offline', 'info');
        return { success: true, offline: true, id: result };
        
    } catch (error) {
        console.error('Save error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// SYNC PENDING COUNTS
// ============================================
async function syncPendingCounts() {
    if (!window.offlineManager) return;
    
    const pending = await window.offlineManager.db.getPendingCounts();
    if (pending.length === 0) {
        showToast('✅ No pending counts to sync', 'success');
        return;
    }
    
    showToast(`🔄 Syncing ${pending.length} pending counts...`, 'info');
    await window.offlineManager.db.syncPendingCounts();
    
    const remaining = await window.offlineManager.db.getPendingCounts();
    if (remaining.length === 0) {
        showToast('✅ All counts synced successfully!', 'success');
    } else {
        showToast(`⚠️ ${remaining.length} counts failed to sync`, 'warning');
    }
}

// ============================================
// ENHANCED SAVE ALL COUNTS
// ============================================
async function saveAllCounts() {
    let warehouse = document.getElementById('warehouse').value;
    let warehouseDisplay = warehouse === '5thFloor' ? '5th Floor Warehouse' : (warehouse === 'Main' ? 'Main Warehouse' : 'All Warehouses');
    
    let countInputs = document.querySelectorAll('.initial-count');
    let totalSkus = countInputs.length;
    let countedSkus = 0;
    let blankSkus = 0;
    let invalidSkus = [];
    let blankSkuNames = [];
    
    let hasInvalid = false;
    for (let i = 0; i < countInputs.length; i++) {
        let input = countInputs[i];
        let value = input.value;
        let row = input.closest('tr');
        let skuName = row ? row.cells[0].innerText : 'Unknown SKU';
        
        if (value !== '' && value !== null) {
            if (isNaN(value) || value.includes('.') || parseFloat(value) < 0 || !Number.isInteger(parseFloat(value))) {
                hasInvalid = true;
                invalidSkus.push(skuName);
                input.style.border = '2px solid red';
            } else {
                input.style.border = '';
                countedSkus++;
            }
        } else {
            blankSkus++;
            blankSkuNames.push(skuName);
            input.style.border = '';
        }
    }
    
    if (hasInvalid) {
        alert(`Cannot save. The following SKU(s) have invalid counts (decimals or negatives):\n\n${invalidSkus.map(s => `  • ${s}`).join('\n')}\n\nPlease correct these entries.`);
        return;
    }
    
    if (blankSkus > 0) {
        let warningMsg = `⚠️ You have ${blankSkus} SKU(s) with NO count entered.\n\n`;
        warningMsg += `Total SKUs: ${totalSkus}\nCounted: ${countedSkus}\nBlank: ${blankSkus}\n\n`;
        warningMsg += `Are you sure you want to save with missing counts?`;
        
        if (!confirm(warningMsg)) {
            return;
        }
    }
    
    let counts = {};
    for (let i = 0; i < countInputs.length; i++) {
        let input = countInputs[i];
        let skuId = input.getAttribute('data-sku-id');
        let count = input.value;
        
        if (count && count !== '') {
            counts[skuId] = { initial_count: parseInt(count, 10) };
        }
    }
    
    if (Object.keys(counts).length === 0) {
        alert('No counts entered. Please enter at least one count before saving.');
        return;
    }
    
    let saveBtn = document.getElementById('saveCounts');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    // Check if offline
    if (!navigator.onLine) {
        let offlineCount = 0;
        for (let skuId in counts) {
            const result = await saveCountOffline(
                parseInt(skuId), 
                counts[skuId].initial_count, 
                currentSessionId
            );
            if (result.success) offlineCount++;
        }
        
        alert(`💾 ${offlineCount} counts saved offline. They will sync when you reconnect.`);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save All Counts';
        }
        return;
    }
    
    // Online - save to server
    try {
        const response = await fetch('/counting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: currentSessionId,
                warehouse: warehouseDisplay,
                counts: counts
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentSessionId = data.session_id;
            
            if (data.recount_needed_count > 0) {
                alert(`⚠️ ${data.recount_needed_count} SKU(s) need recount (discrepancy > 3)\n\nThe recount window will now open.`);
                checkForRecounts();
            } else {
                let completeMsg = `✓ Counts saved successfully!\n\n`;
                completeMsg += `Saved ${Object.keys(counts).length} SKU counts\n✅ No discrepancies found.\n\n`;
                completeMsg += `Do you want to complete the counting session now?`;
                
                if (confirm(completeMsg)) {
                    completeCountingSession();
                }
            }
        } else {
            alert('Error saving counts: ' + (data.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Save error:', error);
        
        if (confirm('⚠️ Connection error. Would you like to save offline?')) {
            let offlineCount = 0;
            for (let skuId in counts) {
                const result = await saveCountOffline(
                    parseInt(skuId), 
                    counts[skuId].initial_count, 
                    currentSessionId
                );
                if (result.success) offlineCount++;
            }
            alert(`💾 ${offlineCount} counts saved offline. They will sync when you reconnect.`);
        } else {
            alert('Save cancelled.');
        }
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save All Counts';
        }
    }
}

// ============================================
// ENHANCED SCANNER
// ============================================
async function startBarcodeScanner() {
    if (isScannerActive) {
        showToast("Scanner is already running", "warning");
        return;
    }
    
    const resultContainer = document.getElementById('qr-reader-results');
    if (resultContainer) {
        resultContainer.innerHTML = '<div class="alert alert-warning">📦 Loading SKU data...</div>';
    }
    
    // Load SKUs
    const loaded = await loadSkus();
    if (!loaded || !window.allSkus || window.allSkus.length === 0) {
        if (resultContainer) {
            resultContainer.innerHTML = '<div class="alert alert-danger">❌ No SKU data available. Please connect to the internet to load SKUs.</div>';
        }
        showToast('❌ No SKU data available', 'error');
        return;
    }
    
    console.log(`✅ Loaded ${window.allSkus.length} SKUs for scanning`);
    
    if (resultContainer) {
        resultContainer.innerHTML = `<div class="alert alert-success">✓ Loaded ${window.allSkus.length} SKUs. Ready to scan!</div>`;
    }
    
    // Scanner initialization
    const scannerModal = new bootstrap.Modal(document.getElementById('scannerModal'));
    scannerModal.show();
    
    if (resultContainer) {
        resultContainer.innerHTML = '<div class="alert alert-info">📷 Initializing camera... Please allow camera access.</div>';
    }
    
    if (html5QrCode) {
        try { await html5QrCode.stop(); } catch(e) {}
        html5QrCode = null;
    }
    
    const readerElement = document.getElementById('qr-reader');
    if (readerElement) {
        readerElement.innerHTML = '';
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    
    try {
        html5QrCode = new Html5Qrcode("qr-reader");
        isScannerActive = true;
        
        const config = {
            fps: 15,
            qrbox: { width: 280, height: 280 },
            aspectRatio: 1.0,
            showTorchButtonIfSupported: true,
            formatsToSupport: [
                Html5QrcodeSupportedFormats.QR_CODE,
                Html5QrcodeSupportedFormats.CODE_128,
                Html5QrcodeSupportedFormats.EAN_13,
                Html5QrcodeSupportedFormats.UPC_A,
                Html5QrcodeSupportedFormats.CODE_39,
                Html5QrcodeSupportedFormats.CODE_93
            ]
        };
        
        await html5QrCode.start(
            { facingMode: "environment" },
            config,
            (decodedText) => {
                let cleanedText = decodedText.trim().replace(/[\n\r]/g, '');
                console.log(`📸 SCANNED: "${cleanedText}"`);
                
                if (resultContainer) {
                    resultContainer.innerHTML = `<div class="alert alert-success">✓ Scanned: ${cleanedText}</div>`;
                }
                showToast(`Scanned: ${cleanedText.substring(0, 50)}`, "success");
                
                stopBarcodeScanner();
                intelligentSkuSearch(cleanedText);
            },
            () => {}
        );
        
        if (resultContainer) {
            resultContainer.innerHTML = '<div class="alert alert-success">✅ Camera ready! Point at QR/Barcode.</div>';
        }
    } catch (err) {
        console.error(`Camera error: ${err}`);
        if (resultContainer) {
            resultContainer.innerHTML = `<div class="alert alert-danger">❌ Camera error: ${err.message || err}. Please check permissions.</div>`;
        }
        isScannerActive = false;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function showLoading(show) {
    const loadingDiv = document.getElementById('loadingIndicator');
    if (loadingDiv) {
        loadingDiv.style.display = show ? 'block' : 'none';
    }
}

function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `alert alert-${type === 'success' ? 'success' : (type === 'error' ? 'danger' : 'info')} alert-dismissible fade show position-fixed`;
    toast.style.bottom = '20px';
    toast.style.left = '50%';
    toast.style.transform = 'translateX(-50%)';
    toast.style.zIndex = '9999';
    toast.style.maxWidth = '90%';
    toast.style.minWidth = '300px';
    toast.style.boxShadow = '0 4px 15px rgba(0,0,0,0.2)';
    toast.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ============================================
// DAY CATEGORY ORDER
// ============================================
const DAY_ORDER = {
    'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
};

const FIFTH_FLOOR_CATEGORIES = [
    'Console/Armrest', 'Deep Dish-3D', 'Deep Dish-5D', 'Deep Dish-5D-CF',
    'Deep Dish-DL', 'Deep Dish-DM', 'Deep Dish-ROHS', 'Deep Dish-TPE-CF',
    'Deep Dish-UN', 'Trunk Tray'
];

// ============================================
// EXISTING FUNCTIONS - COPY FROM YOUR ORIGINAL
// ============================================
// [PASTE ALL YOUR ORIGINAL FUNCTIONS HERE]
// filterItemCategoriesByWarehouse, updateDayCategories, highlightSkusStatus,
// validateCountInput, setupSmartSearch, applyFilters, loadInProgressSkus,
// displaySkusWithPagination, displaySkus, previousPage, nextPage,
// checkForRecounts, showRecountModal, closeRecountModal, saveRecounts,
// completeCountingSession, completeCounting, manualBarcodeEntry,
// intelligentSkuSearch, getUrlParameter, escapeHtml

// ============================================
// DOM INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Setup existing event listeners
    const warehouseSelect = document.getElementById('warehouse');
    const itemCategorySelect = document.getElementById('itemCategory');
    const scannerModal = document.getElementById('scannerModal');
    
    if (warehouseSelect) {
        warehouseSelect.addEventListener('change', function() {
            filterItemCategoriesByWarehouse();
            applyFilters();
        });
    }
    
    if (itemCategorySelect) {
        itemCategorySelect.addEventListener('change', function() {
            updateDayCategories();
            applyFilters();
        });
    }
    
    if (scannerModal) {
        scannerModal.addEventListener('hidden.bs.modal', function () {
            stopBarcodeScanner();
        });
    }
    
    // Setup online/offline listeners
    window.addEventListener('online', function() {
        showToast('🟢 Back online! Syncing...', 'success');
        if (window.offlineManager) {
            window.offlineManager.db.syncPendingCounts();
        }
    });
    
    window.addEventListener('offline', function() {
        showToast('🔴 Offline mode - counts will be saved locally', 'warning');
    });
    
    // Initialize
    filterItemCategoriesByWarehouse();
    setupSmartSearch();
    
    let sessionIdFromUrl = getUrlParameter('session_id');
    if (sessionIdFromUrl) {
        currentSessionId = parseInt(sessionIdFromUrl);
        loadInProgressSkus();
    } else {
        fetch('/api/active_session')
            .then(response => response.json())
            .then(data => {
                if (data.session_id) {
                    currentSessionId = data.session_id;
                }
                loadSkus();
            })
            .catch(error => {
                console.error('Error checking active session:', error);
                loadSkus();
            });
    }
});

// ============================================
// EXPOSE FUNCTIONS GLOBALLY
// ============================================
window.applyFilters = applyFilters;
window.saveAllCounts = saveAllCounts;
window.completeCounting = completeCounting;
window.startBarcodeScanner = startBarcodeScanner;
window.stopBarcodeScanner = stopBarcodeScanner;
window.manualBarcodeEntry = manualBarcodeEntry;
window.previousPage = previousPage;
window.nextPage = nextPage;
window.saveRecounts = saveRecounts;
window.closeRecountModal = closeRecountModal;
window.syncPendingCounts = syncPendingCounts;
window.loadSkus = loadSkus;
