/**
 * MAIN APPLICATION - Inventory Counting System
 * Version: 2.0 (PWA Ready)
 */

// ============================================
// GLOBAL STATE - SINGLE DECLARATION ONLY
// ============================================
// Use window.allSkus to prevent "already declared" errors
// This allows offline.js to access it without redeclaring

// ============================================
// ORIGINAL FUNCTIONS FROM counting.html
// ============================================

// Day Category order mapping
const DAY_ORDER = {
    'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
};

// Define which Item Categories belong to 5th Floor Warehouse
const FIFTH_FLOOR_CATEGORIES = [
    'Console/Armrest', 'Deep Dish-3D', 'Deep Dish-5D', 'Deep Dish-5D-CF',
    'Deep Dish-DL', 'Deep Dish-DM', 'Deep Dish-ROHS', 'Deep Dish-TPE-CF',
    'Deep Dish-UN', 'Trunk Tray'
];

// Store all data from server
let allItemCategories = [];
let allDayCategoriesRaw = [];
let filteredSkus = [];
let currentPage = 1;
let itemsPerPage = 50;
let currentSessionId = null;
let searchTimeout = null;
let html5QrCode = null;
let isScannerActive = false;
let allDayCategories = [];

// Make allSkus available globally (for offline.js)
window.allSkus = [];

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
    toast.style.right = '20px';
    toast.style.zIndex = '9999';
    toast.style.minWidth = '300px';
    toast.innerHTML = `${message}<button type="button" class="btn-close" data-bs-dismiss="alert"></button>`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
}

// ============ QR/BARCODE SCANNER FUNCTIONS ============

async function startBarcodeScanner() {
    if (isScannerActive) {
        showToast("Scanner is already running", "warning");
        return;
    }
    
    // FORCE LOAD ALL SKUs from server using the new endpoint
    showToast("Loading all SKUs from database...", "info");
    const resultContainer = document.getElementById('qr-reader-results');
    if (resultContainer) {
        resultContainer.innerHTML = '<div class="alert alert-warning">📦 Loading ALL SKUs from database... Please wait.</div>';
    }
    
    try {
        // USE THE NEW ENDPOINT that returns ALL SKUs (no 1000 limit)
        const response = await fetch('/api/get_all_skus');
        const data = await response.json();
        window.allSkus = data;
        console.log(`✅ Loaded ${window.allSkus.length} SKUs into memory`);
        
        // Verify Visor SKUs are loaded
        let visorSkus = window.allSkus.filter(s => s.sku && s.sku.toLowerCase().includes("visor"));
        console.log(`Found ${visorSkus.length} Visor SKUs:`, visorSkus.map(s => s.sku));
        
        if (resultContainer) {
            resultContainer.innerHTML = `<div class="alert alert-success">✓ Loaded ${window.allSkus.length} SKUs. Ready to scan!</div>`;
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
        console.error('Error loading SKUs:', error);
        alert('Failed to load SKU data. Please refresh the page.');
        return;
    }
    
    // Rest of the camera initialization code remains the same...
    const scannerModal = new bootstrap.Modal(document.getElementById('scannerModal'));
    scannerModal.show();
    
    if (resultContainer) {
        resultContainer.innerHTML = '<div class="alert alert-info">📷 Initializing camera... Please allow camera access.</div>';
    }
    
    if (html5QrCode) {
        try {
            await html5QrCode.stop();
        } catch(e) {}
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
    
    try {
        await html5QrCode.start(
            { facingMode: "environment" },
            config,
            (decodedText, decodedResult) => {
                // Clean the scanned text
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
        try {
            await html5QrCode.stop();
        } catch(err) {}
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

// FIXED: Simple exact match with cleaned text
function intelligentSkuSearch(scannedText) {
    // Clean the scanned text
    let cleanedScan = scannedText.trim().replace(/[\n\r]/g, '');
    
    console.log("=== SEARCHING FOR:", cleanedScan);
    console.log("Total SKUs in memory:", window.allSkus.length);
    
    if (window.allSkus.length === 0) {
        alert("SKU data not loaded. Please click 'Apply Filters' first, then try scanning.");
        return;
    }
    
    // Find exact match (case-insensitive)
    let exactMatch = null;
    
    for (let sku of window.allSkus) {
        if (sku.sku && sku.sku.toLowerCase() === cleanedScan.toLowerCase()) {
            exactMatch = sku;
            console.log("✅ EXACT MATCH FOUND:", sku.sku);
            break;
        }
    }
    
    if (exactMatch) {
        // Jump to the SKU
        document.getElementById('searchSku').value = exactMatch.sku;
        document.getElementById('warehouse').value = 'All';
        document.getElementById('dayCategory').value = 'All';
        document.getElementById('itemCategory').value = 'All';
        
        applyFilters();
        showToast(`✓ Found: ${exactMatch.sku}`, "success");
        
        setTimeout(() => {
            let row = document.getElementById(`sku-row-${exactMatch.id}`);
            if (row) {
                row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                row.style.backgroundColor = '#90EE90';
                setTimeout(() => {
                    if (row) row.style.backgroundColor = '';
                }, 3000);
            } else {
                setTimeout(() => {
                    let row2 = document.getElementById(`sku-row-${exactMatch.id}`);
                    if (row2) {
                        row2.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        row2.style.backgroundColor = '#90EE90';
                        setTimeout(() => {
                            if (row2) row2.style.backgroundColor = '';
                        }, 3000);
                    }
                }, 1000);
            }
        }, 800);
        return;
    }
    
    // Not found - show helpful message with similar SKUs
    let similar = [];
    for (let sku of window.allSkus) {
        if (sku.sku && sku.sku.toLowerCase().includes(cleanedScan.toLowerCase().substring(0, 8))) {
            similar.push(sku.sku);
        }
    }
    
    if (similar.length > 0) {
        alert(`❌ "${cleanedScan}" not found.\n\nDid you mean?\n• ${similar.slice(0, 5).join('\n• ')}`);
    } else {
        let sampleSkus = window.allSkus.slice(0, 5).map(s => s.sku).join('\n• ');
        alert(`❌ "${cleanedScan}" not found in database.\n\nExample SKUs in system:\n• ${sampleSkus}\n\nPlease check the QR code.`);
    }
}

// ============ END OF QR SCANNER ============

function filterItemCategoriesByWarehouse() {
    let warehouse = document.getElementById('warehouse').value;
    let itemCategorySelect = document.getElementById('itemCategory');
    if (!itemCategorySelect) return;
    
    let currentValue = itemCategorySelect.value;
    
    itemCategorySelect.innerHTML = '<option value="All">-- All Item Categories --</option>';
    
    let filteredCategories = [];
    
    if (warehouse === '5thFloor') {
        filteredCategories = allItemCategories.filter(cat => FIFTH_FLOOR_CATEGORIES.includes(cat));
    } else if (warehouse === 'Main') {
        filteredCategories = allItemCategories.filter(cat => !FIFTH_FLOOR_CATEGORIES.includes(cat));
    } else {
        filteredCategories = [...allItemCategories];
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
    
    let filteredDayCategories = [];
    
    if (selectedItemCategory !== 'All' && window.allSkus.length > 0) {
        let daySet = new Set();
        for (let i = 0; i < window.allSkus.length; i++) {
            if (window.allSkus[i].description === selectedItemCategory && window.allSkus[i].category) {
                daySet.add(window.allSkus[i].category);
            }
        }
        filteredDayCategories = Array.from(daySet);
    } else {
        filteredDayCategories = [...allDayCategories];
    }
    
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

function highlightSkusStatus() {
    let countInputs = document.querySelectorAll('.initial-count');
    let uncountedCount = 0;
    let completedCount = 0;
    let inProgressCount = 0;
    
    for (let i = 0; i < countInputs.length; i++) {
        let input = countInputs[i];
        let row = input ? input.closest('tr') : null;
        if (!row) continue;
        
        let count = input.value;
        
        let isCompleted = row.getAttribute('data-completed') === 'true';
        let isInProgress = row.getAttribute('data-in-progress') === 'true';
        let isExpired = row.getAttribute('data-expired') === 'true';
        
        if (!count || count === '') {
            if (isCompleted && !isExpired) {
                row.classList.add('sku-completed');
                row.classList.remove('sku-in-progress', 'sku-needs-count', 'sku-typing');
                completedCount++;
            } else if (isInProgress) {
                row.classList.add('sku-in-progress');
                row.classList.remove('sku-completed', 'sku-needs-count', 'sku-typing');
                inProgressCount++;
            } else {
                row.classList.add('sku-needs-count');
                row.classList.remove('sku-completed', 'sku-in-progress', 'sku-typing');
                uncountedCount++;
            }
        } else {
            row.classList.add('sku-typing');
            row.classList.remove('sku-completed', 'sku-in-progress', 'sku-needs-count');
        }
    }
    
    let existingUncountedBadge = document.getElementById('uncountedBadge');
    let existingCompletedBadge = document.getElementById('completedBadge');
    let existingInProgressBadge = document.getElementById('inProgressBadge');
    
    if (existingCompletedBadge) existingCompletedBadge.remove();
    if (existingInProgressBadge) existingInProgressBadge.remove();
    if (existingUncountedBadge) existingUncountedBadge.remove();
    
    let title = document.querySelector('h2');
    if (!title) return;
    
    if (completedCount > 0) {
        let badge = document.createElement('span');
        badge.id = 'completedBadge';
        badge.className = 'counted-badge';
        badge.innerHTML = `${completedCount} SKU(s) Completed`;
        title.appendChild(badge);
    }
    
    if (inProgressCount > 0) {
        let badge = document.createElement('span');
        badge.id = 'inProgressBadge';
        badge.className = 'inprogress-badge';
        badge.innerHTML = `${inProgressCount} SKU(s) In Progress`;
        title.appendChild(badge);
    }
    
    if (uncountedCount > 0) {
        let badge = document.createElement('span');
        badge.id = 'uncountedBadge';
        badge.className = 'uncounted-badge';
        badge.innerHTML = `${uncountedCount} SKU(s) Need Count`;
        title.appendChild(badge);
    }
}

function validateCountInput(input) {
    if (!input) return true;
    
    let value = input.value;
    
    if (value === '' || value === null) {
        return true;
    }
    
    if (isNaN(value) || value.includes('.') || parseFloat(value) < 0 || !Number.isInteger(parseFloat(value))) {
        alert('Please enter a valid whole number (no decimals, no negatives)');
        input.value = '';
        input.focus();
        return false;
    }
    return true;
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
            
            for (let i = 0; i < window.allSkus.length && suggestions.length < 15; i++) {
                let sku = window.allSkus[i];
                if (sku.sku && sku.sku.toLowerCase().includes(term.toLowerCase())) {
                    if (!seen.has(sku.sku)) {
                        seen.add(sku.sku);
                        suggestions.push({
                            sku: sku.sku,
                            description: sku.description,
                            id: sku.id
                        });
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
                    div.style.fontSize = '14px';
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

function applyFilters() {
    let warehouse = document.getElementById('warehouse').value;
    let dayCategory = document.getElementById('dayCategory').value;
    let itemCategory = document.getElementById('itemCategory').value;
    let search = document.getElementById('searchSku').value;
    
    loadSkus(warehouse, dayCategory, itemCategory, search);
}

function loadInProgressSkus() {
    let sessionIdFromUrl = getUrlParameter('session_id');
    if (!sessionIdFromUrl) {
        applyFilters();
        return;
    }
    
    currentSessionId = parseInt(sessionIdFromUrl);
    
    let loadingDiv = document.getElementById('loadingIndicator');
    let skusListDiv = document.getElementById('skusList');
    
    if (loadingDiv) loadingDiv.style.display = 'block';
    if (skusListDiv) skusListDiv.innerHTML = '<div class="col-12"><div class="alert alert-info text-center">Loading in-progress SKUs...</div></div>';
    
    fetch(`/get_in_progress_skus/${currentSessionId}`)
        .then(response => response.json())
        .then(data => {
            if (data.skus && data.skus.length > 0) {
                for (let i = 0; i < data.skus.length; i++) {
                    data.skus[i].in_progress = true;
                    data.skus[i].has_count = true;
                    data.skus[i].current_count = data.skus[i].current_count;
                    data.skus[i].count_time = data.skus[i].count_time;
                }
                window.allSkus = data.skus;
                filteredSkus = data.skus;
                currentPage = 1;
                displaySkus(data.skus);
                if (loadingDiv) loadingDiv.style.display = 'none';
            } else {
                if (skusListDiv) skusListDiv.innerHTML = '<div class="col-12"><div class="alert alert-warning text-center">No in-progress SKUs found. Loading all SKUs...</div></div>';
                applyFilters();
                if (loadingDiv) loadingDiv.style.display = 'none';
            }
        })
        .catch(error => {
            console.error('Error loading in-progress SKUs:', error);
            applyFilters();
            if (loadingDiv) loadingDiv.style.display = 'none';
        });
}

function loadSkus(warehouse, dayCategory, itemCategory, search) {
    let loadingDiv = document.getElementById('loadingIndicator');
    let skusListDiv = document.getElementById('skusList');
    
    if (loadingDiv) loadingDiv.style.display = 'block';
    if (skusListDiv) skusListDiv.innerHTML = '<div class="col-12"><div class="alert alert-info text-center">Loading SKUs...</div></div>';
    
    let url = '/get_skus?day_category=' + encodeURIComponent(dayCategory) + 
              '&item_category=' + encodeURIComponent(itemCategory) + 
              '&search=' + encodeURIComponent(search);
    
    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error('HTTP error ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            window.allSkus = data;
            
            let warehouseFiltered = [];
            for (let i = 0; i < data.length; i++) {
                let sku = data[i];
                let belongsTo5thFloor = FIFTH_FLOOR_CATEGORIES.includes(sku.description);
                
                if (warehouse === '5thFloor' && belongsTo5thFloor) {
                    warehouseFiltered.push(sku);
                } else if (warehouse === 'Main' && !belongsTo5thFloor) {
                    warehouseFiltered.push(sku);
                } else if (warehouse === 'All') {
                    warehouseFiltered.push(sku);
                }
            }
            
            filteredSkus = warehouseFiltered;
            currentPage = 1;
            displaySkusWithPagination();
            if (loadingDiv) loadingDiv.style.display = 'none';
            updateDayCategories();
        })
        .catch(error => {
            console.error('Error loading SKUs:', error);
            if (skusListDiv) {
                skusListDiv.innerHTML = '<div class="col-12"><div class="alert alert-danger text-center">Error loading SKUs: ' + error.message + '</div></div>';
            }
            if (loadingDiv) loadingDiv.style.display = 'none';
        });
}

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
                pageInfo.textContent = 'Page ' + currentPage + ' of ' + totalPages + ' (' + filteredSkus.length + ' total SKUs)';
            }
        } else {
            paginationDiv.style.display = 'none';
        }
    }
    
    if (currentSessionId && filteredSkus.length > 0) {
        loadExistingCountsForSkus();
    }
}

function loadExistingCountsForSkus() {
    let skuIds = filteredSkus.map(s => s.id).join(',');
    if (!skuIds) return;
    
    fetch(`/get_latest_counts?sku_ids=${skuIds}&session_id=${currentSessionId}`)
        .then(response => response.json())
        .then(latestCounts => {
            for (let skuId in latestCounts) {
                let countInput = document.querySelector(`.initial-count[data-sku-id="${skuId}"]`);
                let lastCountedSpan = document.getElementById(`last-counted-${skuId}`);
                let lastCountValueSpan = document.getElementById(`last-count-value-${skuId}`);
                
                if (countInput && latestCounts[skuId]) {
                    countInput.value = latestCounts[skuId].initial_count;
                    
                    if (lastCountedSpan) {
                        lastCountedSpan.innerHTML = latestCounts[skuId].count_time;
                    }
                    if (lastCountValueSpan) {
                        lastCountValueSpan.innerHTML = latestCounts[skuId].initial_count;
                    }
                    
                    let row = countInput.closest('tr');
                    if (row) {
                        row.setAttribute('data-in-progress', 'true');
                        row.setAttribute('data-completed', 'false');
                    }
                }
            }
            highlightSkusStatus();
        })
        .catch(error => console.error('Error loading existing counts:', error));
}

function displaySkus(skus) {
    let skusListDiv = document.getElementById('skusList');
    
    if (!skusListDiv) {
        console.error("skusList element not found!");
        return;
    }
    
    if (!skus || skus.length === 0) {
        skusListDiv.innerHTML = '<div class="col-12"><div class="alert alert-warning text-center">No SKUs found. Try different filters.</div></div>';
        return;
    }
    
    let html = '<div class="col-12"><div class="table-responsive"><table class="table table-bordered table-hover table-striped">';
    html += '<thead class="table-dark">';
    html += '<tr>';
    html += '<th>SKU</th>';
    html += '<th>Description (Item Category)</th>';
    html += '<th>Day Category</th>';
    html += '<th>Last Count Date</th>';
    html += '<th>Last Count</th>';
    html += '<th>Container Qty</th>';
    html += '<th>Container Details</th>';
    html += '<th>Final Expected</th>';
    html += '<th>Kenneth\'s Inv</th>';
    html += '<th>Current Count</th>';
    html += '<th>Last Counted Date</th>';
    html += '<th>Previous Count</th>';
    html += '<th>Status</th>';
    html += '</tr>';
    html += '</thead><tbody>';
    
    for (let i = 0; i < skus.length; i++) {
        let sku = skus[i];
        let statusBadge = '';
        let existingCountTime = '';
        let finalCountValue = '';
        let isInProgress = false;
        let isCompleted = false;
        let isExpired = false;
        let rowClass = '';
        let existingCountValue = '';
        
        if (sku.has_count === true && !sku.in_progress && sku.is_completed === true && !sku.is_expired) {
            existingCountTime = sku.count_time || '';
            finalCountValue = sku.final_count;
            isCompleted = true;
            rowClass = 'sku-completed';
            statusBadge = '<span class="badge bg-success">Completed (ready for next count)</span>';
        }
        else if (sku.is_expired === true) {
            isExpired = true;
            rowClass = 'sku-needs-count';
            statusBadge = '<span class="badge bg-warning">Expired - Needs Recount</span>';
        }
        else if (sku.in_progress === true || (sku.has_count === true && sku.current_count !== undefined && sku.current_count !== null && sku.current_count !== '')) {
            existingCountValue = sku.current_count;
            existingCountTime = sku.count_time || '';
            finalCountValue = sku.final_count || sku.current_count;
            isInProgress = true;
            rowClass = 'sku-in-progress';
            statusBadge = '<span class="badge bg-primary">In Progress</span>';
        }
        
        if (sku.bypass_recount) {
            statusBadge = '<span class="badge bg-warning">Bypass Recount</span>';
        }
        
        let containerDetails = sku.container_details || '-';
        if (containerDetails.length > 50) {
            containerDetails = containerDetails.substring(0, 50) + '...';
        }
        
        let lastCountDate = sku.last_count_date || '-';
        if (lastCountDate !== '-' && lastCountDate.length > 10) {
            lastCountDate = lastCountDate.split(' ')[0];
        }
        
        let inputValue = (isInProgress && existingCountValue) ? existingCountValue : '';
        let inputPlaceholder = 'Enter count';
        
        let lastCountClass = 'fw-bold text-dark';
        let finalExpectedClass = 'fw-bold text-dark';
        let kennethClass = 'fw-bold text-dark';
        
        let rowId = `sku-row-${sku.id}`;
        
        html += `<tr id="${rowId}" class="${rowClass}" data-in-progress="${isInProgress}" data-completed="${isCompleted}" data-expired="${isExpired}">`;
        html += '<td><strong>' + escapeHtml(sku.sku) + '</strong></td>';
        html += '<td>' + escapeHtml(sku.description || '-') + '</td>';
        html += '<td>' + escapeHtml(sku.category || '-') + '</td>';
        html += '<td class="text-nowrap">' + escapeHtml(lastCountDate) + '</td>';
        html += '<td class="' + lastCountClass + '">' + (sku.last_count || 0) + '</td>';
        html += '<td>' + (sku.total_container_qty || 0) + '</td>';
        html += '<td><small>' + escapeHtml(containerDetails) + '</small></td>';
        html += '<td class="' + finalExpectedClass + '">' + (sku.final_expected_count || 0) + '</td>';
        html += '<td class="' + kennethClass + '">' + (sku.kenneth_inventory || 0) + '</td>';
        html += '<td>';
        html += `<input type="text" class="form-control initial-count" data-sku-id="${sku.id}" style="min-width: 100px; width: 100px;" placeholder="${inputPlaceholder}" inputmode="numeric"`;
        if (inputValue) {
            html += ` value="${inputValue}"`;
        }
        html += '>';
        html += '</td>';
        html += '<td>';
        if (existingCountTime && !isExpired) {
            html += `<span id="last-counted-${sku.id}" style="color: #0d6efd; font-weight: bold;">${existingCountTime}</span>`;
        } else {
            html += `<span id="last-counted-${sku.id}">-</span>`;
        }
        html += '</td>';
        html += '<td>';
        if (finalCountValue && !isExpired) {
            html += `<span id="last-count-value-${sku.id}" style="color: #0d6efd; font-weight: bold;">${finalCountValue}</span>`;
        } else {
            html += `<span id="last-count-value-${sku.id}">-</span>`;
        }
        html += '</td>';
        html += '<td>' + statusBadge + '</td>';
        html += '</tr>';
    }
    
    html += '</tbody></table></div></div>';
    
    let sessionIdFromUrl = getUrlParameter('session_id');
    if (sessionIdFromUrl && currentSessionId == sessionIdFromUrl && filteredSkus.length > 0) {
        let banner = `<div class="col-12 mb-3">
            <div class="alert alert-info">
                <i class="bi bi-info-circle"></i> 
                <strong>Continuing Session #${currentSessionId}</strong> - Showing ${filteredSkus.length} SKU(s) that have been counted but not completed.
                <br><small>Click "Apply Filters" to see all SKUs or continue counting these.</small>
            </div>
        </div>`;
        skusListDiv.innerHTML = banner + html;
    } else {
        skusListDiv.innerHTML = html;
    }
    
    // Bind events after DOM is updated
    setTimeout(function() {
        document.querySelectorAll('.initial-count').forEach(function(input) {
            if (input) {
                input.addEventListener('blur', function() {
                    if (this.value !== '' && this.value !== null) {
                        validateCountInput(this);
                    }
                    highlightSkusStatus();
                });
                
                input.addEventListener('keypress', function(e) {
                    if (e.key === 'Enter') {
                        this.blur();
                        return;
                    }
                    if (!/[\d]/.test(e.key) && 
                        e.key !== 'Backspace' && 
                        e.key !== 'Delete' && 
                        e.key !== 'Tab' && 
                        e.key !== 'ArrowLeft' && 
                        e.key !== 'ArrowRight') {
                        e.preventDefault();
                        alert('Only numbers are allowed. Please enter a whole number.');
                    }
                });
                
                input.addEventListener('input', function() {
                    let row = this.closest('tr');
                    if (row) {
                        row.classList.add('sku-typing');
                        row.classList.remove('sku-completed', 'sku-in-progress', 'sku-needs-count');
                    }
                    highlightSkusStatus();
                });
            }
        });
        
        highlightSkusStatus();
    }, 100);
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

function saveAllCounts() {
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
        warningMsg += `Total SKUs: ${totalSkus}\n`;
        warningMsg += `Counted: ${countedSkus}\n`;
        warningMsg += `Blank: ${blankSkus}\n\n`;
        
        if (blankSkus <= 5) {
            warningMsg += `Uncounted SKUs:\n${blankSkuNames.map(s => `  • ${s}`).join('\n')}\n\n`;
        } else {
            warningMsg += `First 5 uncounted: ${blankSkuNames.slice(0, 5).join(', ')}\n`;
            warningMsg += `... and ${blankSkus - 5} more\n\n`;
        }
        
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
            counts[skuId] = {initial_count: parseInt(count, 10)};
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
    
    // Check if offline - use offline save
    if (!navigator.onLine) {
        saveCountsOffline(counts, saveBtn);
        return;
    }
    
    // Online - save to server
    fetch('/counting', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
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
            
            if (data.recount_needed_count > 0) {
                alert(`⚠️ ${data.recount_needed_count} SKU(s) need recount (discrepancy > 3)\n\nThe recount window will now open.`);
                checkForRecounts();
            } else {
                let completeMsg = `✓ Counts saved successfully!\n\n`;
                completeMsg += `Saved ${Object.keys(counts).length} SKU counts\n`;
                completeMsg += `✅ No discrepancies found.\n\n`;
                completeMsg += `Do you want to complete the counting session now?`;
                
                if (confirm(completeMsg)) {
                    completeCountingSession();
                }
            }
        } else {
            alert('Error saving counts');
        }
    })
    .catch(error => {
        console.error('Save error:', error);
        // Fallback to offline save
        if (confirm('⚠️ Connection error. Would you like to save offline?')) {
            saveCountsOffline(counts, saveBtn);
        } else {
            alert('Save cancelled.');
        }
    })
    .finally(() => {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save All Counts';
        }
    });
}

// ============================================
// OFFLINE COUNT SAVING HELPER
// ============================================
async function saveCountsOffline(counts, saveBtn) {
    let offlineCount = 0;
    for (let skuId in counts) {
        try {
            const countData = {
                sku_id: parseInt(skuId),
                count: counts[skuId].initial_count,
                session_id: currentSessionId,
                timestamp: new Date().toISOString()
            };
            
            if (window.offlineManager && window.offlineManager.db) {
                await window.offlineManager.db.addPendingCount(countData);
                offlineCount++;
            } else {
                // Fallback: store in localStorage
                let pending = JSON.parse(localStorage.getItem('pending_counts') || '[]');
                pending.push(countData);
                localStorage.setItem('pending_counts', JSON.stringify(pending));
                offlineCount++;
            }
        } catch (e) {
            console.error('Offline save error:', e);
        }
    }
    
    alert(`💾 ${offlineCount} counts saved offline. They will sync when you reconnect.`);
    if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save All Counts';
    }
}

function checkForRecounts() {
    if (!currentSessionId) return;
    
    fetch('/get_recount_list?session_id=' + currentSessionId)
        .then(response => response.json())
        .then(data => {
            if (data.length > 0) {
                showRecountModal(data);
            } else {
                fetch('/check_recount_status?session_id=' + currentSessionId)
                    .then(res => res.json())
                    .then(status => {
                        if (!status.has_pending_recounts) {
                            if (confirm('All counts are valid!\n\nDo you want to complete the counting session now?')) {
                                completeCountingSession();
                            }
                        }
                    });
            }
        });
}

function showRecountModal(recountItems) {
    console.log("Recount Items:", recountItems);
    
    let html = '<div class="table-responsive"><table class="table table-bordered">';
    html += '<thead class="table-dark">';
    html += '<tr>';
    html += '<th>SKU</th>';
    html += '<th>Description</th>';
    html += '<th>Initial Count</th>';
    html += '<th>Final Expected Count</th>';
    html += '<th>Kenneth\'s Inventory</th>';
    html += '<th>Recount Count</th>';
    html += '<th>Remarks (Optional)</th>';
    html += '</tr></thead><tbody>';
    
    for (let i = 0; i < recountItems.length; i++) {
        let item = recountItems[i];
        html += '<tr>';
        html += '<td><strong>' + escapeHtml(item.sku) + '</strong></td>';
        html += '<td>' + escapeHtml(item.description || '-') + '</td>';
        html += '<td class="bg-warning">' + (item.initial_count || 0) + '</td>';
        html += '<td class="bg-info">' + (item.final_expected_count || 0) + '</td>';
        html += '<td class="bg-info">' + (item.kenneth_inventory || 0) + '</td>';
        html += '<td><input type="text" class="form-control recount-count" data-record-id="' + item.id + '" style="width: 120px;" placeholder="Enter whole number" inputmode="numeric"></td>';
        html += '<td><textarea class="form-control recount-remarks" data-record-id="' + item.id + '" rows="2" placeholder="Optional: Reason for discrepancy (e.g., 9 were damaged)" style="width: 250px;"></textarea></td>';
        html += '</tr>';
    }
    
    html += '</tbody></table></div>';
    html += '<div class="mt-3 d-flex justify-content-between">';
    html += '<button class="btn btn-secondary" onclick="closeRecountModal()">Close</button>';
    html += '<button class="btn btn-success" onclick="saveRecounts()">Save Recounts & Complete Session</button>';
    html += '</div>';
    
    let modalHtml = `
        <div class="modal fade" id="recountModal" tabindex="-1" data-bs-backdrop="static" data-bs-keyboard="false">
            <div class="modal-dialog modal-xl">
                <div class="modal-content">
                    <div class="modal-header bg-warning">
                        <h5 class="modal-title">⚠️ Recount Required</h5>
                        <button type="button" class="btn-close" onclick="closeRecountModal()"></button>
                    </div>
                    <div class="modal-body">
                        <div class="alert alert-danger">
                            <strong>Important:</strong> The following SKUs have discrepancies greater than 3 units.
                            Please recount and enter the correct quantity.
                        </div>
                        ${html}
                    </div>
                </div>
            </div>
        </div>
    `;
    
    let existingModal = document.getElementById('recountModal');
    if (existingModal) {
        existingModal.remove();
    }
    
    document.body.insertAdjacentHTML('beforeend', modalHtml);
    
    // Bind events for recount inputs
    document.querySelectorAll('.recount-count').forEach(input => {
        input.addEventListener('blur', function() {
            let value = this.value;
            if (value !== '' && value !== null) {
                if (isNaN(value) || value.includes('.') || parseFloat(value) < 0 || !Number.isInteger(parseFloat(value))) {
                    alert('Invalid count. Please enter a whole number (no decimals, no negatives).');
                    this.value = '';
                    this.focus();
                } else {
                    this.value = parseInt(value, 10);
                }
            }
        });
        
        input.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') {
                this.blur();
                return;
            }
            if (!/[\d]/.test(e.key) && 
                e.key !== 'Backspace' && 
                e.key !== 'Delete' && 
                e.key !== 'Tab' && 
                e.key !== 'ArrowLeft' && 
                e.key !== 'ArrowRight') {
                e.preventDefault();
                alert('Only numbers are allowed.');
            }
        });
    });
    
    let modal = new bootstrap.Modal(document.getElementById('recountModal'), {
        backdrop: 'static',
        keyboard: false
    });
    modal.show();
}

function closeRecountModal() {
    let modal = document.getElementById('recountModal');
    if (modal) {
        let bsModal = bootstrap.Modal.getInstance(modal);
        if (bsModal) bsModal.hide();
        modal.remove();
    }
}

function saveRecounts() {
    let recounts = [];
    let countInputs = document.querySelectorAll('.recount-count');
    let hasError = false;
    let errorMessage = '';
    
    for (let i = 0; i < countInputs.length; i++) {
        let input = countInputs[i];
        let recordId = input.getAttribute('data-record-id');
        let recountCount = input.value;
        let remarks = document.querySelector('.recount-remarks[data-record-id="' + recordId + '"]').value;
        
        let row = input.closest('tr');
        let skuName = row ? row.cells[0].innerText : 'Unknown';
        
        if (!recountCount || recountCount === '') {
            hasError = true;
            errorMessage += `• Please enter recount count for ${skuName}\n`;
            input.style.border = '2px solid red';
        } else if (isNaN(recountCount) || recountCount.includes('.') || parseFloat(recountCount) < 0 || !Number.isInteger(parseFloat(recountCount))) {
            hasError = true;
            errorMessage += `• Invalid recount count for ${skuName}. Please enter a whole number (no decimals)\n`;
            input.style.border = '2px solid red';
        } else {
            input.style.border = '';
        }
        
        let remarksInput = document.querySelector('.recount-remarks[data-record-id="' + recordId + '"]');
        if (remarksInput) remarksInput.style.border = '';
        
        recounts.push({
            record_id: recordId,
            recount_count: recountCount ? parseInt(recountCount, 10) : 0,
            remarks: remarks || ''
        });
    }
    
    if (hasError) {
        alert('Please fix the following issues:\n\n' + errorMessage);
        return;
    }
    
    let saveBtn = document.querySelector('#recountModal .btn-success');
    let originalText = saveBtn ? saveBtn.textContent : 'Saving...';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    fetch('/save_recount', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({recounts: recounts})
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            let modal = document.getElementById('recountModal');
            if (modal) {
                let bsModal = bootstrap.Modal.getInstance(modal);
                if (bsModal) bsModal.hide();
                modal.remove();
            }
            completeCountingSession();
        } else {
            alert('Error saving recounts');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = originalText;
            }
        }
    })
    .catch(error => {
        alert('Error: ' + error);
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalText;
        }
    });
}

function completeCountingSession() {
    if (!currentSessionId) {
        alert('Please save counts first');
        return;
    }
    
    fetch('/complete_counting', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({session_id: currentSessionId})
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
    .catch(error => {
        alert('Error: ' + error);
    });
}

function completeCounting() {
    if (!currentSessionId) {
        alert('Please save counts first');
        return;
    }
    
    fetch('/check_recount_status?session_id=' + currentSessionId)
        .then(response => response.json())
        .then(data => {
            if (data.has_pending_recounts) {
                alert(`Cannot complete session. You have ${data.count} pending recount(s) that need to be completed first.`);
                return;
            }
            
            if (confirm('Complete this counting session? This will mark all counts as final.')) {
                completeCountingSession();
            }
        });
}

// ============================================
// SYNC PENDING COUNTS (Manual trigger)
// ============================================
async function syncPendingCounts() {
    if (!window.offlineManager) {
        showToast('⚠️ Offline manager not available', 'warning');
        return;
    }
    
    const pending = await window.offlineManager.db.getPendingCounts();
    if (pending.length === 0) {
        // Also check localStorage fallback
        const localPending = JSON.parse(localStorage.getItem('pending_counts') || '[]');
        if (localPending.length > 0) {
            showToast(`📤 Found ${localPending.length} counts in localStorage. Migrating...`, 'info');
            // Migrate from localStorage to IndexedDB
            for (const count of localPending) {
                await window.offlineManager.db.addPendingCount(count);
            }
            localStorage.removeItem('pending_counts');
            // Then sync
            await window.offlineManager.db.syncPendingCounts();
        } else {
            showToast('✅ No pending counts to sync', 'success');
        }
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
// DOM INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Get categories from server (passed from Flask)
    // These are set in the template
    if (typeof item_categories !== 'undefined') {
        allItemCategories = item_categories;
    }
    if (typeof day_categories !== 'undefined') {
        allDayCategoriesRaw = day_categories;
        allDayCategories = [...allDayCategoriesRaw].sort((a, b) => {
            let orderA = DAY_ORDER[a] || 999;
            let orderB = DAY_ORDER[b] || 999;
            return orderA - orderB;
        });
    }
    
    // Initialize offline manager
    if (window.offlineManager) {
        window.offlineManager.init().then(() => {
            console.log('✅ Offline manager ready');
            
            // Check for pending counts
            window.offlineManager.db.getPendingCounts().then(pending => {
                if (pending.length > 0) {
                    showToast(`📤 ${pending.length} pending counts to sync`, 'info');
                    // Auto-sync after 3 seconds
                    setTimeout(() => syncPendingCounts(), 3000);
                }
            });
        });
    } else {
        // Check localStorage fallback
        const localPending = JSON.parse(localStorage.getItem('pending_counts') || '[]');
        if (localPending.length > 0) {
            showToast(`📤 ${localPending.length} counts in localStorage. Will sync when online.`, 'info');
        }
    }
    
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
    
    // Setup online/offline listeners
    window.addEventListener('online', function() {
        showToast('🟢 Back online! Syncing...', 'success');
        syncPendingCounts();
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
                applyFilters();
            })
            .catch(error => {
                console.error('Error checking active session:', error);
                applyFilters();
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
