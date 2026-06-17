/**
 * MAIN APPLICATION - Inventory Counting System
 * Version: 2.0 (PWA Ready - Fixed Loading)
 */

// ============================================
// GLOBAL STATE
// ============================================
let allSkus = [];
let filteredSkus = [];
let currentPage = 1;
let itemsPerPage = 50;
let currentSessionId = null;
let searchTimeout = null;
let html5QrCode = null;
let isScannerActive = false;

// ============================================
// SIMPLE SKU LOADING - FIXED VERSION
// ============================================
async function loadSkus() {
    let loadingDiv = document.getElementById('loadingIndicator');
    let skusListDiv = document.getElementById('skusList');
    
    if (loadingDiv) loadingDiv.style.display = 'block';
    if (skusListDiv) {
        skusListDiv.innerHTML = '<div class="col-12"><div class="alert alert-info text-center">Loading SKUs...</div></div>';
    }
    
    try {
        console.log('🔍 Fetching SKUs from server...');
        const response = await fetch('/api/get_all_skus');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        console.log(`✅ Loaded ${data.length} SKUs from server`);
        
        allSkus = data;
        
        // Try to cache for offline (don't wait for it)
        if (window.offlineManager && window.offlineManager.db) {
            try {
                await window.offlineManager.db.saveSkus(allSkus);
                console.log('💾 SKUs cached offline');
            } catch (cacheError) {
                console.log('ℹ️ Offline cache skipped:', cacheError.message);
            }
        }
        
        // Apply filters and display
        applyFilters();
        
        if (loadingDiv) loadingDiv.style.display = 'none';
        return true;
        
    } catch (error) {
        console.error('❌ Error loading SKUs:', error);
        
        // Try to load from offline cache as fallback
        if (window.offlineManager && window.offlineManager.db) {
            try {
                const cached = await window.offlineManager.db.getAllSkus();
                if (cached && cached.length > 0) {
                    console.log(`📦 Using ${cached.length} cached SKUs (offline fallback)`);
                    allSkus = cached;
                    applyFilters();
                    if (loadingDiv) loadingDiv.style.display = 'none';
                    showToast('📶 Using cached SKUs (offline mode)', 'warning');
                    return true;
                }
            } catch (cacheError) {
                console.log('ℹ️ Cache fallback failed:', cacheError.message);
            }
        }
        
        // If we get here, we have no data
        if (skusListDiv) {
            skusListDiv.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-danger text-center">
                        <strong>❌ Error loading SKUs:</strong> ${error.message}
                        <br><small>Please refresh the page or contact support.</small>
                    </div>
                </div>
            `;
        }
        
        if (loadingDiv) loadingDiv.style.display = 'none';
        return false;
    }
}

// ============================================
// ORIGINAL APPLY FILTERS - PRESERVED
// ============================================
function applyFilters() {
    let warehouse = document.getElementById('warehouse').value;
    let dayCategory = document.getElementById('dayCategory').value;
    let itemCategory = document.getElementById('itemCategory').value;
    let search = document.getElementById('searchSku').value;
    
    // Filter the loaded SKUs
    let filtered = [...allSkus];
    
    // Filter by warehouse
    if (warehouse === '5thFloor') {
        filtered = filtered.filter(sku => FIFTH_FLOOR_CATEGORIES.includes(sku.description));
    } else if (warehouse === 'Main') {
        filtered = filtered.filter(sku => !FIFTH_FLOOR_CATEGORIES.includes(sku.description));
    }
    
    // Filter by day category
    if (dayCategory && dayCategory !== 'All' && dayCategory !== '-- All Day Categories --') {
        filtered = filtered.filter(sku => sku.category === dayCategory);
    }
    
    // Filter by item category
    if (itemCategory && itemCategory !== 'All' && itemCategory !== '-- All Item Categories --') {
        filtered = filtered.filter(sku => sku.description === itemCategory);
    }
    
    // Filter by search
    if (search && search.trim()) {
        const searchTerm = search.trim().toLowerCase();
        filtered = filtered.filter(sku => 
            sku.sku.toLowerCase().includes(searchTerm) || 
            (sku.description && sku.description.toLowerCase().includes(searchTerm))
        );
    }
    
    filteredSkus = filtered;
    currentPage = 1;
    
    // Update day categories
    updateDayCategories();
    
    // Display SKUs with pagination
    displaySkusWithPagination();
    
    // Update page info
    let totalPages = Math.ceil(filteredSkus.length / itemsPerPage);
    let pageInfo = document.getElementById('pageInfo');
    if (pageInfo) {
        pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${filteredSkus.length} total SKUs)`;
    }
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
// YOUR EXISTING FUNCTIONS - PRESERVED
// ============================================

function getUrlParameter(name) {
    let urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
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

function filterItemCategoriesByWarehouse() {
    let warehouse = document.getElementById('warehouse').value;
    let itemCategorySelect = document.getElementById('itemCategory');
    if (!itemCategorySelect) return;
    
    let currentValue = itemCategorySelect.value;
    itemCategorySelect.innerHTML = '<option value="All">-- All Item Categories --</option>';
    
    // Get categories from allSkus
    let allCategories = [];
    let filteredCategories = [];
    
    for (let i = 0; i < allSkus.length; i++) {
        let desc = allSkus[i].description;
        if (desc && !allCategories.includes(desc)) {
            allCategories.push(desc);
        }
    }
    
    if (warehouse === '5thFloor') {
        filteredCategories = allCategories.filter(cat => FIFTH_FLOOR_CATEGORIES.includes(cat));
    } else if (warehouse === 'Main') {
        filteredCategories = allCategories.filter(cat => !FIFTH_FLOOR_CATEGORIES.includes(cat));
    } else {
        filteredCategories = [...allCategories];
    }
    
    filteredCategories.sort();
    
    for (let i = 0; i < filteredCategories.length; i++) {
        let option = document.createElement('option');
        option.value = filteredCategories[i];
        option.textContent = filteredCategories[i];
        itemCategorySelect.appendChild(option);
    }
    
    if (currentValue !== 'All' && filteredCategories.includes(currentValue)) {
        itemCategorySelect.value = currentValue;
    }
    
    updateDayCategories();
}

function updateDayCategories() {
    let selectedItemCategory = document.getElementById('itemCategory').value;
    let dayCategorySelect = document.getElementById('dayCategory');
    if (!dayCategorySelect) return;
    
    let currentValue = dayCategorySelect.value;
    dayCategorySelect.innerHTML = '<option value="All">-- All Day Categories --</option>';
    
    let daySet = new Set();
    
    // Get all day categories from allSkus
    for (let i = 0; i < allSkus.length; i++) {
        let sku = allSkus[i];
        if (selectedItemCategory === 'All' || sku.description === selectedItemCategory) {
            if (sku.category) {
                daySet.add(sku.category);
            }
        }
    }
    
    let filteredDayCategories = Array.from(daySet);
    filteredDayCategories.sort((a, b) => {
        let orderA = DAY_ORDER[a] || 999;
        let orderB = DAY_ORDER[b] || 999;
        return orderA - orderB;
    });
    
    for (let i = 0; i < filteredDayCategories.length; i++) {
        if (filteredDayCategories[i]) {
            let option = document.createElement('option');
            option.value = filteredDayCategories[i];
            option.textContent = filteredDayCategories[i];
            dayCategorySelect.appendChild(option);
        }
    }
    
    if (currentValue !== 'All' && filteredDayCategories.includes(currentValue)) {
        dayCategorySelect.value = currentValue;
    }
}

// ============================================
// DISPLAY FUNCTIONS
// ============================================

function displaySkusWithPagination() {
    let startIndex = (currentPage - 1) * itemsPerPage;
    let endIndex = startIndex + itemsPerPage;
    let pageSkus = filteredSkus.slice(startIndex, endIndex);
    
    displaySkus(pageSkus);
    
    let paginationDiv = document.getElementById('paginationControls');
    if (paginationDiv) {
        if (filteredSkus.length > itemsPerPage) {
            paginationDiv.style.display = 'block';
            let totalPages = Math.ceil(filteredSkus.length / itemsPerPage);
            let pageInfo = document.getElementById('pageInfo');
            if (pageInfo) {
                pageInfo.textContent = `Page ${currentPage} of ${totalPages} (${filteredSkus.length} total SKUs)`;
            }
        } else {
            paginationDiv.style.display = 'none';
        }
    }
}

function displaySkus(skus) {
    let skusListDiv = document.getElementById('skusList');
    if (!skusListDiv) return;
    
    if (!skus || skus.length === 0) {
        skusListDiv.innerHTML = '<div class="col-12"><div class="alert alert-warning text-center">No SKUs found. Try different filters.</div></div>';
        return;
    }
    
    let html = '<div class="col-12"><div class="table-responsive"><table class="table table-bordered table-hover table-striped">';
    html += '<thead class="table-dark"><tr>';
    html += '<th>SKU</th><th>Description (Item Category)</th><th>Day Category</th>';
    html += '<th>Last Count Date</th><th>Last Count</th>';
    html += '<th>Final Expected</th><th>Kenneth\'s Inv</th>';
    html += '<th>Current Count</th><th>Status</th>';
    html += '</tr></thead><tbody>';
    
    for (let i = 0; i < skus.length; i++) {
        let sku = skus[i];
        let statusBadge = '<span class="badge bg-secondary">Not Counted</span>';
        let rowClass = 'sku-needs-count';
        
        html += `<tr id="sku-row-${sku.id}" class="${rowClass}">`;
        html += `<td><strong>${escapeHtml(sku.sku)}</strong></td>`;
        html += `<td>${escapeHtml(sku.description || '-')}</td>`;
        html += `<td>${escapeHtml(sku.category || '-')}</td>`;
        html += `<td>${escapeHtml(sku.last_count_date || '-')}</td>`;
        html += `<td>${sku.last_count || 0}</td>`;
        html += `<td>${sku.final_expected_count || 0}</td>`;
        html += `<td>${sku.kenneth_inventory || 0}</td>`;
        html += `<td><input type="text" class="form-control initial-count" data-sku-id="${sku.id}" style="min-width: 100px; width: 100px;" placeholder="Enter count" inputmode="numeric"></td>`;
        html += `<td>${statusBadge}</td>`;
        html += '</tr>';
    }
    
    html += '</tbody></table></div></div>';
    skusListDiv.innerHTML = html;
    
    // Bind events
    setTimeout(function() {
        document.querySelectorAll('.initial-count').forEach(function(input) {
            input.addEventListener('change', function() {
                validateCountInput(this);
            });
        });
    }, 100);
}

function validateCountInput(input) {
    if (!input) return true;
    let value = input.value;
    if (value === '' || value === null) return true;
    if (isNaN(value) || value.includes('.') || parseFloat(value) < 0 || !Number.isInteger(parseFloat(value))) {
        alert('Please enter a valid whole number (no decimals, no negatives)');
        input.value = '';
        input.focus();
        return false;
    }
    return true;
}

function previousPage() {
    if (currentPage > 1) {
        currentPage--;
        displaySkusWithPagination();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function nextPage() {
    let totalPages = Math.ceil(filteredSkus.length / itemsPerPage);
    if (currentPage < totalPages) {
        currentPage++;
        displaySkusWithPagination();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

function setupSmartSearch() {
    let searchInput = document.getElementById('searchSku');
    let suggestionsDiv = document.getElementById('suggestions');
    
    if (!searchInput || !suggestionsDiv) return;
    
    searchInput.addEventListener('input', function() {
        let term = this.value.trim();
        if (term.length < 2) {
            suggestionsDiv.style.display = 'none';
            return;
        }
        
        if (searchTimeout) clearTimeout(searchTimeout);
        
        searchTimeout = setTimeout(function() {
            let suggestions = [];
            let seen = new Set();
            
            for (let i = 0; i < allSkus.length && suggestions.length < 15; i++) {
                let sku = allSkus[i];
                if (sku.sku && sku.sku.toLowerCase().includes(term.toLowerCase())) {
                    if (!seen.has(sku.sku)) {
                        seen.add(sku.sku);
                        suggestions.push({sku: sku.sku, description: sku.description, id: sku.id});
                    }
                }
            }
            
            if (suggestions.length > 0) {
                suggestionsDiv.innerHTML = '';
                for (let i = 0; i < suggestions.length; i++) {
                    let item = suggestions[i];
                    let div = document.createElement('div');
                    div.className = 'suggestion-item';
                    div.style.padding = '8px 12px';
                    div.style.cursor = 'pointer';
                    div.style.borderBottom = '1px solid #eee';
                    div.innerHTML = `<strong>${escapeHtml(item.sku)}</strong> <small class="text-muted">${escapeHtml(item.description || '')}</small>`;
                    div.onclick = (function(skuValue) {
                        return function() {
                            searchInput.value = skuValue;
                            suggestionsDiv.style.display = 'none';
                            applyFilters();
                        };
                    })(item.sku);
                    suggestionsDiv.appendChild(div);
                }
                suggestionsDiv.style.display = 'block';
            } else {
                suggestionsDiv.style.display = 'none';
            }
        }, 300);
    });
    
    document.addEventListener('click', function(e) {
        if (e.target !== searchInput && suggestionsDiv && !suggestionsDiv.contains(e.target)) {
            suggestionsDiv.style.display = 'none';
        }
    });
    
    searchInput.addEventListener('keypress', function(e) {
        if (e.which === 13) {
            if (suggestionsDiv) suggestionsDiv.style.display = 'none';
            applyFilters();
        }
    });
}

// ============================================
// SCANNER FUNCTIONS
// ============================================

async function startBarcodeScanner() {
    if (isScannerActive) {
        showToast("Scanner is already running", "warning");
        return;
    }
    
    // Make sure SKUs are loaded
    if (allSkus.length === 0) {
        showToast("Please wait for SKUs to load first", "warning");
        return;
    }
    
    const resultContainer = document.getElementById('qr-reader-results');
    if (resultContainer) {
        resultContainer.innerHTML = `<div class="alert alert-success">✅ ${allSkus.length} SKUs loaded. Ready to scan!</div>`;
    }
    
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
    
    html5QrCode = new Html5Qrcode("qr-reader");
    isScannerActive = true;
    
    const config = {
        fps: 15,
        qrbox: { width: 280, height: 280 },
        aspectRatio: 1.0,
        showTorchButtonIfSupported: true
    };
    
    try {
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
            (errorMessage) => {}
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

async function stopBarcodeScanner() {
    isScannerActive = false;
    if (html5QrCode) {
        try { await html5QrCode.stop(); } catch(err) {}
        html5QrCode = null;
    }
    const readerElement = document.getElementById('qr-reader');
    if (readerElement) {
        readerElement.innerHTML = '';
    }
    const scannerModal = bootstrap.Modal.getInstance(document.getElementById('scannerModal'));
    if (scannerModal) {
        scannerModal.hide();
    }
    const resultContainer = document.getElementById('qr-reader-results');
    if (resultContainer) {
        resultContainer.innerHTML = '';
    }
}

function manualBarcodeEntry() {
    let barcode = prompt('Enter barcode/QR code value:');
    if (barcode && barcode.trim()) {
        stopBarcodeScanner();
        intelligentSkuSearch(barcode.trim().replace(/[\n\r]/g, ''));
    }
}

function intelligentSkuSearch(scannedText) {
    let cleanedScan = scannedText.trim().replace(/[\n\r]/g, '');
    console.log("=== SEARCHING FOR:", cleanedScan);
    console.log("Total SKUs in memory:", allSkus.length);
    
    if (allSkus.length === 0) {
        alert("SKU data not loaded. Please refresh the page.");
        return;
    }
    
    // Find exact match
    let exactMatch = null;
    for (let sku of allSkus) {
        if (sku.sku && sku.sku.toLowerCase() === cleanedScan.toLowerCase()) {
            exactMatch = sku;
            console.log("✅ EXACT MATCH FOUND:", sku.sku);
            break;
        }
    }
    
    if (exactMatch) {
        document.getElementById('searchSku').value = exactMatch.sku;
        document.getElementById('warehouse').value = 'All';
        document.getElementById('dayCategory').value = 'All';
        document.getElementById('itemCategory').value = 'All';
        applyFilters();
        showToast(`✓ Found: ${exactMatch.sku}`, "success");
        return;
    }
    
    // Not found
    let similar = [];
    for (let sku of allSkus) {
        if (sku.sku && sku.sku.toLowerCase().includes(cleanedScan.toLowerCase().substring(0, 8))) {
            similar.push(sku.sku);
        }
    }
    
    if (similar.length > 0) {
        alert(`❌ "${cleanedScan}" not found.\n\nDid you mean?\n• ${similar.slice(0, 5).join('\n• ')}`);
    } else {
        let sampleSkus = allSkus.slice(0, 5).map(s => s.sku).join('\n• ');
        alert(`❌ "${cleanedScan}" not found in database.\n\nExample SKUs in system:\n• ${sampleSkus}`);
    }
}

// ============================================
// SAVE COUNTS
// ============================================

function saveAllCounts() {
    let countInputs = document.querySelectorAll('.initial-count');
    let counts = {};
    let hasCount = false;
    
    for (let i = 0; i < countInputs.length; i++) {
        let input = countInputs[i];
        let skuId = input.getAttribute('data-sku-id');
        let value = input.value;
        
        if (value && value !== '') {
            if (!validateCountInput(input)) return;
            counts[skuId] = { initial_count: parseInt(value, 10) };
            hasCount = true;
        }
    }
    
    if (!hasCount) {
        alert('No counts entered. Please enter at least one count before saving.');
        return;
    }
    
    let saveBtn = document.getElementById('saveCounts');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    let warehouse = document.getElementById('warehouse').value;
    let warehouseDisplay = warehouse === '5thFloor' ? '5th Floor Warehouse' : (warehouse === 'Main' ? 'Main Warehouse' : 'All Warehouses');
    
    fetch('/counting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session_id: currentSessionId,
            warehouse: warehouseDisplay,
            counts: counts
        })
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            currentSessionId = data.session_id;
            showToast(`✅ Saved ${Object.keys(counts).length} counts!`, 'success');
            if (data.recount_needed_count > 0) {
                alert(`⚠️ ${data.recount_needed_count} SKU(s) need recount (discrepancy > 3)`);
            }
        } else {
            alert('Error saving counts');
        }
    })
    .catch(error => {
        alert('Error: ' + error);
    })
    .finally(() => {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save All Counts';
        }
    });
}

function completeCounting() {
    if (!currentSessionId) {
        alert('Please save counts first');
        return;
    }
    if (confirm('Complete this counting session? This will mark all counts as final.')) {
        fetch('/complete_counting', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: currentSessionId })
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                alert('✓ Counting session completed successfully!');
                window.location.href = '/dashboard';
            } else {
                alert(data.message || 'Error completing session');
            }
        })
        .catch(error => alert('Error: ' + error));
    }
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', function() {
    console.log('🚀 Inventory App Initializing...');
    
    // Setup event listeners
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
    
    setupSmartSearch();
    
    // Load SKUs
    loadSkus().then(success => {
        if (!success) {
            console.error('Failed to load SKUs');
        }
    });
    
    // Check for active session
    fetch('/api/active_session')
        .then(response => response.json())
        .then(data => {
            if (data.session_id) {
                currentSessionId = data.session_id;
                console.log('📋 Active session:', currentSessionId);
            }
        })
        .catch(error => console.error('Error checking active session:', error));
});

// ============================================
// GLOBAL EXPOSURE
// ============================================
window.applyFilters = applyFilters;
window.saveAllCounts = saveAllCounts;
window.completeCounting = completeCounting;
window.startBarcodeScanner = startBarcodeScanner;
window.stopBarcodeScanner = stopBarcodeScanner;
window.manualBarcodeEntry = manualBarcodeEntry;
window.previousPage = previousPage;
window.nextPage = nextPage;
