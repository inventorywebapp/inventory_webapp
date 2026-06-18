/**
 * MAIN APPLICATION - Inventory Counting System
 * Version: 2.6 (FULLY FIXED - Offline Save Working)
 */

// ============================================
// GLOBAL STATE - DECLARED ONCE
// ============================================
let allSkus = [];
let filteredSkus = [];
let currentPage = 1;
let itemsPerPage = 50;
let currentSessionId = null;
let searchTimeout = null;
let html5QrCode = null;
let isScannerActive = false;
let isOfflineMode = false;

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
// LOAD SKUS
// ============================================
function loadSkus(warehouse, dayCategory, itemCategory, search) {
    let loadingDiv = document.getElementById('loadingIndicator');
    let skusListDiv = document.getElementById('skusList');
    
    if (loadingDiv) loadingDiv.style.display = 'block';
    if (skusListDiv) {
        skusListDiv.innerHTML = '<div class="col-12"><div class="alert alert-info text-center">Loading SKUs...</div></div>';
    }
    
    let url = '/get_skus?';
    if (dayCategory && dayCategory !== 'All' && dayCategory !== '-- All Day Categories --') {
        url += 'day_category=' + encodeURIComponent(dayCategory) + '&';
    }
    if (itemCategory && itemCategory !== 'All' && itemCategory !== '-- All Item Categories --') {
        url += 'item_category=' + encodeURIComponent(itemCategory) + '&';
    }
    if (search && search.trim()) {
        url += 'search=' + encodeURIComponent(search.trim());
    }
    url = url.replace(/[&?]$/, '');
    
    console.log('🔍 Fetching SKUs from:', url);
    
    fetch(url)
        .then(response => {
            if (!response.ok) {
                throw new Error('HTTP error ' + response.status);
            }
            return response.json();
        })
        .then(data => {
            console.log('✅ Loaded', data.length, 'SKUs');
            allSkus = data;
            
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
            
            if (window.offlineManager && window.offlineManager.db) {
                window.offlineManager.db.saveSkus(allSkus).catch(e => console.log('Cache save skipped:', e));
            }
        })
        .catch(error => {
            console.error('❌ Error loading SKUs:', error);
            loadSkusFromCache().then(success => {
                if (!success) {
                    if (skusListDiv) {
                        skusListDiv.innerHTML = `
                            <div class="col-12">
                                <div class="alert alert-danger text-center">
                                    <strong>❌ Error loading SKUs:</strong> ${error.message}
                                    <br><small>Please check your connection and refresh.</small>
                                </div>
                            </div>
                        `;
                    }
                    if (loadingDiv) loadingDiv.style.display = 'none';
                }
            });
        });
}

// ============================================
// LOAD SKUS FROM CACHE
// ============================================
async function loadSkusFromCache() {
    let loadingDiv = document.getElementById('loadingIndicator');
    let skusListDiv = document.getElementById('skusList');
    
    console.log('📶 Attempting to load SKUs from cache...');
    
    if (window.offlineManager && window.offlineManager.db) {
        try {
            const cachedSkus = await window.offlineManager.db.getAllSkus();
            if (cachedSkus && cachedSkus.length > 0) {
                console.log(`✅ Loaded ${cachedSkus.length} SKUs from cache`);
                allSkus = cachedSkus;
                if (loadingDiv) loadingDiv.style.display = 'none';
                filterAndDisplaySkus(
                    document.getElementById('warehouse').value,
                    document.getElementById('dayCategory').value,
                    document.getElementById('itemCategory').value,
                    document.getElementById('searchSku').value
                );
                showToast('📶 Offline mode - using cached SKUs', 'warning');
                return true;
            } else {
                console.warn('⚠️ No SKUs in cache');
                if (skusListDiv) {
                    skusListDiv.innerHTML = `
                        <div class="col-12">
                            <div class="alert alert-warning text-center">
                                <strong>📶 Offline mode</strong><br>
                                No cached SKUs available. Please connect to the internet first.
                            </div>
                        </div>
                    `;
                }
                if (loadingDiv) loadingDiv.style.display = 'none';
                showToast('📶 Offline - no cached SKUs available', 'error');
                return false;
            }
        } catch (error) {
            console.error('❌ Cache error:', error);
            if (loadingDiv) loadingDiv.style.display = 'none';
            showToast('📶 Offline - error loading cache', 'error');
            return false;
        }
    } else {
        console.warn('⚠️ Offline manager not available');
        if (skusListDiv) {
            skusListDiv.innerHTML = `
                <div class="col-12">
                    <div class="alert alert-warning text-center">
                        <strong>📶 Offline mode</strong><br>
                        Offline features not available.
                    </div>
                </div>
            `;
        }
        if (loadingDiv) loadingDiv.style.display = 'none';
        showToast('📶 Offline features not available', 'error');
        return false;
    }
}

// ============================================
// APPLY FILTERS
// ============================================
function applyFilters() {
    let warehouse = document.getElementById('warehouse').value;
    let dayCategory = document.getElementById('dayCategory').value;
    let itemCategory = document.getElementById('itemCategory').value;
    let search = document.getElementById('searchSku').value;
    
    if (!navigator.onLine && allSkus.length === 0) {
        loadSkusFromCache();
        return;
    }
    
    loadSkus(warehouse, dayCategory, itemCategory, search);
}

// ============================================
// FILTER AND DISPLAY SKUS
// ============================================
function filterAndDisplaySkus(warehouse, dayCategory, itemCategory, search) {
    let filtered = [...allSkus];
    
    if (warehouse === '5thFloor') {
        filtered = filtered.filter(sku => FIFTH_FLOOR_CATEGORIES.includes(sku.description));
    } else if (warehouse === 'Main') {
        filtered = filtered.filter(sku => !FIFTH_FLOOR_CATEGORIES.includes(sku.description));
    }
    
    if (dayCategory && dayCategory !== 'All' && dayCategory !== '-- All Day Categories --') {
        filtered = filtered.filter(sku => sku.category === dayCategory);
    }
    
    if (itemCategory && itemCategory !== 'All' && itemCategory !== '-- All Item Categories --') {
        filtered = filtered.filter(sku => sku.description === itemCategory);
    }
    
    if (search && search.trim()) {
        const searchTerm = search.trim().toLowerCase();
        filtered = filtered.filter(sku => 
            sku.sku.toLowerCase().includes(searchTerm) || 
            (sku.description && sku.description.toLowerCase().includes(searchTerm))
        );
    }
    
    filteredSkus = filtered;
    currentPage = 1;
    displaySkusWithPagination();
}

// ============================================
// SAVE ALL COUNTS - COMPLETELY REWRITTEN
// ============================================
function saveAllCounts() {
    // Get warehouse
    let warehouse = document.getElementById('warehouse').value;
    let warehouseDisplay = warehouse === '5thFloor' ? '5th Floor Warehouse' : (warehouse === 'Main' ? 'Main Warehouse' : 'All Warehouses');
    
    // Get all count inputs
    let countInputs = document.querySelectorAll('.initial-count');
    let totalSkus = countInputs.length;
    let countedSkus = 0;
    let blankSkus = 0;
    let invalidSkus = [];
    let blankSkuNames = [];
    
    // Validate inputs
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
    
    // Build counts object
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
    
    // Disable button
    let saveBtn = document.getElementById('saveCounts');
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    
    // ==========================================
    // CHECK IF OFFLINE - THIS IS THE KEY FIX
    // ==========================================
    const isOffline = !navigator.onLine;
    console.log('📶 SAVE - Network status:', isOffline ? 'OFFLINE' : 'ONLINE');
    
    // ==========================================
    // IF OFFLINE - SAVE TO INDEXEDDB
    // ==========================================
    if (isOffline) {
        console.log('📶 SAVING OFFLINE - to IndexedDB');
        
        // Check offline manager
        if (!window.offlineManager || !window.offlineManager.isInitialized) {
            alert('⚠️ Offline features are still initializing. Please try again in a moment.');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save All Counts';
            }
            return;
        }
        
        // Save each count to IndexedDB
        let promises = [];
        for (let skuId in counts) {
            const promise = window.offlineManager.saveCountOffline(
                parseInt(skuId), 
                counts[skuId].initial_count, 
                currentSessionId
            );
            promises.push(promise);
        }
        
        if (promises.length === 0) {
            showToast('⚠️ No counts to save', 'warning');
            if (saveBtn) {
                saveBtn.disabled = false;
                saveBtn.textContent = 'Save All Counts';
            }
            return;
        }
        
        Promise.all(promises)
            .then(results => {
                const successCount = results.filter(r => r && r.success).length;
                console.log(`💾 OFFLINE: ${successCount} counts saved`);
                showToast(`💾 ${successCount} counts saved offline - will sync when online`, 'success');
                
                // Update pending badge
                window.offlineManager.db.getPendingCounts().then(pending => {
                    const badge = document.querySelector('.pending-badge');
                    if (badge && pending.length > 0) {
                        badge.textContent = pending.length;
                        badge.style.display = 'inline-block';
                    }
                });
                
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save All Counts';
                }
            })
            .catch(error => {
                console.error('❌ OFFLINE SAVE ERROR:', error);
                alert('Error saving offline: ' + error.message);
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save All Counts';
                }
            });
        return; // EXIT - DO NOT FETCH
    }
    
    // ==========================================
    // ONLINE - SAVE TO SERVER
    // ==========================================
    console.log('📡 SAVING ONLINE - to server');
    
    fetch('/counting', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            session_id: currentSessionId,
            warehouse: warehouseDisplay,
            counts: counts
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('HTTP error ' + response.status);
        }
        return response.json();
    })
    .then(data => {
        if (data.success) {
            currentSessionId = data.session_id;
            showToast(`✅ ${Object.keys(counts).length} counts saved!`, 'success');
            
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
    })
    .catch(error => {
        console.error('❌ ONLINE SAVE ERROR:', error);
        
        // Fallback to offline
        if (confirm('⚠️ Connection error. Would you like to save offline instead?')) {
            if (!window.offlineManager || !window.offlineManager.isInitialized) {
                alert('Offline features not available. Please try again.');
                if (saveBtn) {
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Save All Counts';
                }
                return;
            }
            
            let promises = [];
            for (let skuId in counts) {
                const promise = window.offlineManager.saveCountOffline(
                    parseInt(skuId), 
                    counts[skuId].initial_count, 
                    currentSessionId
                );
                promises.push(promise);
            }
            
            Promise.all(promises)
                .then(results => {
                    const successCount = results.filter(r => r && r.success).length;
                    showToast(`💾 ${successCount} counts saved offline - will sync when online`, 'success');
                })
                .catch(err => {
                    console.error('Offline fallback error:', err);
                    alert('Error saving offline: ' + err.message);
                });
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
// CHECK OFFLINE STATUS
// ============================================
function checkOfflineStatus() {
    const status = {
        isOnline: navigator.onLine,
        offlineManagerExists: !!window.offlineManager,
        offlineManagerReady: window.offlineManager ? window.offlineManager.isInitialized : false,
        allSkusCount: allSkus.length,
        pendingCounts: 0
    };
    
    console.log('📶 OFFLINE STATUS:', status);
    
    if (window.offlineManager && window.offlineManager.isInitialized) {
        window.offlineManager.db.getPendingCounts().then(pending => {
            status.pendingCounts = pending.length;
            console.log('📶 Pending counts:', pending.length);
            const badge = document.querySelector('.pending-badge');
            if (badge && pending.length > 0) {
                badge.textContent = pending.length;
                badge.style.display = 'inline-block';
            }
        });
    }
    
    if (!navigator.onLine) {
        showToast('📶 OFFLINE MODE - Counts will be saved locally', 'warning');
    } else {
        showToast('📶 ONLINE MODE - Counts will sync to server', 'success');
    }
    
    return status;
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
    html += '<th>Container Qty</th><th>Container Details</th>';
    html += '<th>Final Expected</th><th>Kenneth\'s Inv</th>';
    html += '<th>Current Count</th><th>Last Counted Date</th>';
    html += '<th>Previous Count</th><th>Status</th>';
    html += '</tr></thead><tbody>';
    
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
            statusBadge = '<span class="badge bg-success">Completed</span>';
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
        
        html += `<tr id="sku-row-${sku.id}" class="${rowClass}" data-in-progress="${isInProgress}" data-completed="${isCompleted}" data-expired="${isExpired}">`;
        html += '<td><strong>' + escapeHtml(sku.sku) + '</strong></td>';
        html += '<td>' + escapeHtml(sku.description || '-') + '</td>';
        html += '<td>' + escapeHtml(sku.category || '-') + '</td>';
        html += '<td class="text-nowrap">' + escapeHtml(lastCountDate) + '</td>';
        html += '<td>' + (sku.last_count || 0) + '</td>';
        html += '<td>' + (sku.total_container_qty || 0) + '</td>';
        html += '<td><small>' + escapeHtml(containerDetails) + '</small></td>';
        html += '<td>' + (sku.final_expected_count || 0) + '</td>';
        html += '<td>' + (sku.kenneth_inventory || 0) + '</td>';
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
    skusListDiv.innerHTML = html;
    
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

// ============================================
// UTILITY FUNCTIONS
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

function filterItemCategoriesByWarehouse() {
    let warehouse = document.getElementById('warehouse').value;
    let itemCategorySelect = document.getElementById('itemCategory');
    if (!itemCategorySelect) return;
    
    let currentValue = itemCategorySelect.value;
    itemCategorySelect.innerHTML = '<option value="All">-- All Item Categories --</option>';
    
    let allCategories = [];
    for (let i = 0; i < allSkus.length; i++) {
        let desc = allSkus[i].description;
        if (desc && !allCategories.includes(desc)) {
            allCategories.push(desc);
        }
    }
    
    let filteredCategories = [];
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
                allSkus = data.skus;
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

// ============================================
// SCANNER FUNCTIONS
// ============================================
async function startBarcodeScanner() {
    if (isScannerActive) {
        showToast("Scanner is already running", "warning");
        return;
    }
    
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
    html += '<thead class="table-dark"><tr>';
    html += '<th>SKU</th><th>Description</th><th>Initial Count</th>';
    html += '<th>Final Expected Count</th><th>Kenneth\'s Inventory</th>';
    html += '<th>Recount Count</th><th>Remarks (Optional)</th>';
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
        html += '<td><textarea class="form-control recount-remarks" data-record-id="' + item.id + '" rows="2" placeholder="Optional: Reason for discrepancy" style="width: 250px;"></textarea></td>';
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recounts: recounts })
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
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
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
    
    filterItemCategoriesByWarehouse();
    setupSmartSearch();
    
    const isOffline = !navigator.onLine;
    console.log('📶 Initial load - Network status:', isOffline ? 'OFFLINE' : 'ONLINE');
    
    if (isOffline) {
        console.log('📶 OFFLINE - Loading from cache');
        loadSkusFromCache().then(success => {
            if (!success) {
                const skusListDiv = document.getElementById('skusList');
                if (skusListDiv) {
                    skusListDiv.innerHTML = `
                        <div class="col-12">
                            <div class="alert alert-warning text-center">
                                <strong>📶 Offline mode</strong><br>
                                No cached SKUs available. Please connect to the internet first.
                            </div>
                        </div>
                    `;
                }
            }
        });
        return;
    }
    
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
window.saveRecounts = saveRecounts;
window.closeRecountModal = closeRecountModal;
window.checkOfflineStatus = checkOfflineStatus;
