// 打卡地點：Nominatim 地址搜尋 + 可拖曳微調的選取器地圖
// 從 script.js 拆出，只依賴 utils.js / i18n.js / libs.js 與 showNotification()。

// ==================== 地點搜尋功能 ====================

// 台灣地址在 OpenStreetMap 上的門牌資料很少，「新北市蘆洲區南港里長榮路711號」這種
// 含「里」與門牌的完整地址幾乎都查不到。所以搜尋順序是：
//   1. 直接貼上的座標或 Google 地圖連結 → 不用查
//   2. 後端 Google 地理編碼（Apps Script 內建，門牌命中率高）
//   3. Nominatim，查不到再依序去掉「里／鄰」、門牌號碼，至少定位到路段，再請管理員拖曳微調

/**
 * 全形數字與標點轉半形，使用者從 LINE、Word 貼過來的地址常是全形
 */
function normalizeSearchText(text) {
    return String(text)
        .replace(/[\uFF10-\uFF19]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
        .replace(/，/g, ',')
        .replace(/．/g, '.')
        .replace(/－/g, '-')
        .trim();
}

/**
 * 從文字中解析座標：「25.08, 121.47」或 Google 地圖連結（@lat,lng / !3dlat!4dlng / q=lat,lng）
 * @returns {{lat:number, lng:number}|null}
 */
function parseCoordinates(text) {
    const s = normalizeSearchText(text);
    const patterns = [
        /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,      // 地點頁的精確座標，優先於 @（@ 是地圖視角中心）
        /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
        /[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,
        /^\s*\(?\s*(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)\s*\)?\s*$/
    ];
    for (const re of patterns) {
        const m = s.match(re);
        if (m) {
            const lat = parseFloat(m[1]);
            const lng = parseFloat(m[2]);
            if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) return { lat, lng };
        }
    }
    return null;
}

/**
 * 越來越寬鬆的查詢字串：原文 → 去掉里／鄰 → 再去掉門牌（只到路段）
 */
function addressQueryVariants(query) {
    const variants = [query];
    const noVillage = query
        // 只拿掉「區／鄉／鎮／市」後面的那一段里名，前面的行政區要留著
        .replace(/([區鄉鎮市])[\u4e00-\u9fa5]{1,3}里(?=[\u4e00-\u9fa5\d])/, '$1')
        .replace(/\d+鄰/, '');
    variants.push(noVillage);
    const noNumber = noVillage
        .replace(/\d+(-\d+)?號.*$/, '')
        .replace(/\d+(巷|弄).*$/, '');
    variants.push(noNumber);
    return [...new Set(variants.map(v => v.trim()).filter(Boolean))];
}

async function nominatimSearch(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
        + `&limit=5&accept-language=zh-TW&countrycodes=tw`;
    const response = await fetch(url);
    if (!response.ok) throw new Error('搜尋失敗');
    return await response.json();
}

/**
 * 搜尋地點，回傳 [{ display_name, lat, lon, approximate? }]
 */
async function searchLocation(query) {
    if (!query || query.trim() === '') {
        return [];
    }
    query = normalizeSearchText(query);
    
    const coords = parseCoordinates(query);
    if (coords) {
        return [{ display_name: `${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`, lat: coords.lat, lon: coords.lng, isCoordinate: true }];
    }
    
    // 1. Google 地理編碼（後端）。舊版後端沒有這支 API 時會回錯誤，直接往下走
    try {
        const res = await callApifetch(`geocodeAddress&q=${encodeURIComponent(query)}`, 'geocode-none');
        if (res && res.ok && res.results && res.results.length) return res.results;
    } catch (err) {
        console.warn('後端地理編碼失敗，改用 OpenStreetMap:', err);
    }
    
    // 2. OpenStreetMap，逐步放寬
    try {
        const variants = addressQueryVariants(query);
        for (let i = 0; i < variants.length; i++) {
            const results = await nominatimSearch(variants[i]);
            if (results.length) {
                // 放寬過的結果只到路段，提醒管理員要在地圖上微調
                return i === 0 ? results : results.map(r => ({ ...r, approximate: true }));
            }
        }
        return [];
        
    } catch (error) {
        console.error('地點搜尋錯誤:', error);
        showNotification(t('NOTIF_SEARCH_FAILED'), 'error');
        return [];
    }
}

/**
 * 顯示搜尋結果
 */
function displaySearchResults(results) {
    const resultsList = document.getElementById('search-results-list');
    const resultsContainer = document.getElementById('search-results');
    
    if (!resultsList || !resultsContainer) return;
    
    resultsList.innerHTML = '';
    
    if (results.length === 0) {
        resultsContainer.classList.add('hidden');
        showNotification(t('NOTIF_NO_PLACE_FOUND'), 'warning');
        return;
    }
    
    // 貼上的是座標就不用再選
    if (results.length === 1 && results[0].isCoordinate) {
        selectSearchResult(results[0]);
        return;
    }
    
    resultsContainer.classList.remove('hidden');
    
    results.forEach(result => {
        const li = document.createElement('li');
        li.className = 'text-sm text-gray-800 dark:text-gray-200';
        li.innerHTML = `
            <div class="font-semibold">${escapeHtml(result.display_name)}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                ${parseFloat(result.lat).toFixed(6)}, ${parseFloat(result.lon).toFixed(6)}
                ${result.approximate ? `<span class="text-amber-600 dark:text-amber-400 ml-1">${escapeHtml(t('SEARCH_RESULT_APPROXIMATE'))}</span>` : ''}
            </div>
        `;
        
        li.addEventListener('click', () => {
            selectSearchResult(result);
        });
        
        resultsList.appendChild(li);
    });
}

/**
 * 選擇搜尋結果
 */
function selectSearchResult(result) {
    const nameInput = document.getElementById('location-name');
    const latInput = document.getElementById('location-lat');
    const lngInput = document.getElementById('location-lng');
    const addBtn = document.getElementById('add-location-btn');
    const resultsContainer = document.getElementById('search-results');
    
    // 座標沒有名稱可帶；已經有名稱的話也不要覆蓋管理員自己打的
    if (nameInput && !result.isCoordinate && !nameInput.value.trim()) {
        nameInput.value = result.display_name.split(',')[0].trim();
    }
    if (latInput) latInput.value = parseFloat(result.lat).toFixed(6);
    if (lngInput) lngInput.value = parseFloat(result.lon).toFixed(6);
    if (addBtn) addBtn.disabled = false;
    if (resultsContainer) resultsContainer.classList.add('hidden');
    
    // 在下方小地圖標出這個點，之後可以拖曳微調
    setPickerLocation(parseFloat(result.lat), parseFloat(result.lon));
    
    showNotification(t(result.approximate ? 'NOTIF_LOCATION_PICKED_APPROX' : 'NOTIF_LOCATION_PICKED'),
        result.approximate ? 'warning' : 'success');
}

// ==================== 打卡地點選取器（可拖曳微調） ====================
// 搜尋回來的座標是建物或路段中心，跟實際打卡的門口常差數十公尺，
// 所以在「新增打卡地點」表單裡放一張小地圖，標記可以拖，圓圈即時跟著半徑走。

let pickerMap = null;
let pickerMarker = null;
let pickerCircle = null;

function pickerRadius() {
    const slider = document.getElementById('location-radius');
    return slider ? parseInt(slider.value) : 200;
}

// 把座標寫回表單欄位
function writePickedCoords(lat, lng) {
    const latInput = document.getElementById('location-lat');
    const lngInput = document.getElementById('location-lng');
    const addBtn = document.getElementById('add-location-btn');
    if (latInput) latInput.value = lat.toFixed(6);
    if (lngInput) lngInput.value = lng.toFixed(6);
    if (addBtn) addBtn.disabled = false;
}

/**
 * 在選取器地圖上標出座標；地圖第一次用到時才建立。
 */
async function setPickerLocation(lat, lng) {
    writePickedCoords(lat, lng);
    
    const el = document.getElementById('location-picker-map');
    if (!el) return;
    
    try {
        await ensureLib('leaflet');
    } catch (err) {
        console.error('地圖載入失敗:', err);
        return;
    }
    
    const coords = [lat, lng];
    const radius = pickerRadius();
    
    if (!pickerMap) {
        el.innerHTML = '';
        el.classList.remove('flex', 'items-center', 'justify-center');
        pickerMap = L.map(el).setView(coords, 18);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(pickerMap);
        
        pickerMarker = L.marker(coords, { draggable: true }).addTo(pickerMap);
        pickerCircle = L.circle(coords, {
            color: 'blue', fillColor: '#30f', fillOpacity: 0.2, radius: radius
        }).addTo(pickerMap);
        
        // 拖曳結束就把新座標寫回欄位，圓圈也跟著移動
        pickerMarker.on('drag', (e) => pickerCircle.setLatLng(e.target.getLatLng()));
        pickerMarker.on('dragend', (e) => {
            const p = e.target.getLatLng();
            writePickedCoords(p.lat, p.lng);
            showNotification(t('NOTIF_PICKER_ADJUSTED', { lat: p.lat.toFixed(6), lng: p.lng.toFixed(6) }), 'success');
        });
        // 點地圖也能直接改點位
        pickerMap.on('click', (e) => setPickerLocation(e.latlng.lat, e.latlng.lng));
        
        setTimeout(() => pickerMap.invalidateSize(), 100);
    } else {
        pickerMap.setView(coords, Math.max(pickerMap.getZoom(), 17));
        pickerMarker.setLatLng(coords);
        pickerCircle.setLatLng(coords).setRadius(radius);
    }
}

// 分頁切回管理員時，地圖是在隱藏狀態下建立的話尺寸會歪掉
function refreshLocationPicker() {
    if (pickerMap) setTimeout(() => pickerMap.invalidateSize(), 100);
}

// ==================== 範圍調整拉桿 ====================

/**
 * 初始化範圍拉桿
 */
function initRadiusSlider() {
    const slider = document.getElementById('location-radius');
    const valueDisplay = document.getElementById('radius-value');
    
    if (!slider || !valueDisplay) return;
    
    slider.addEventListener('input', (e) => {
        const value = e.target.value;
        valueDisplay.textContent = value;
        
        //  修正：先檢查 circle 是否存在
        if (circle && currentCoords) {
            circle.setRadius(parseInt(value));
        }
        
        // 新增打卡地點的選取器地圖也要跟著改
        if (pickerCircle) {
            pickerCircle.setRadius(parseInt(value));
        }
    });
}

// 經緯度欄位可以手動輸入或貼上（例如從 Google 地圖長按複製的座標），輸入完就同步到地圖
document.addEventListener('DOMContentLoaded', () => {
    const latInput = document.getElementById('location-lat');
    const lngInput = document.getElementById('location-lng');
    if (!latInput || !lngInput) return;
    
    const sync = (e) => {
        // 整組「25.08, 121.47」貼進任一欄也接受
        const pasted = parseCoordinates(e.target.value);
        if (pasted) {
            setPickerLocation(pasted.lat, pasted.lng);
            return;
        }
        const lat = parseFloat(normalizeSearchText(latInput.value));
        const lng = parseFloat(normalizeSearchText(lngInput.value));
        if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
            setPickerLocation(lat, lng);
        }
    };
    latInput.addEventListener('change', sync);
    lngInput.addEventListener('change', sync);
});

// ==================== 打卡地點列表：編輯、刪除 ====================
// 「編輯」會把地點帶回上面的新增表單（含可拖曳的選取器地圖），改完按同一顆按鈕儲存。

let locationList = [];
let editingLocation = null;   // 編輯中的地點（null = 新增模式）
let _locationListLoading = null;

function distanceMeters(lat1, lng1, lat2, lng2) {
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function loadLocationList() {
    if (!document.getElementById('location-list')) return Promise.resolve();
    if (_locationListLoading) return _locationListLoading;
    _locationListLoading = _doLoadLocationList().finally(() => { _locationListLoading = null; });
    return _locationListLoading;
}

async function _doLoadLocationList() {
    const status = document.getElementById('location-list-status');
    status.textContent = t('LOADING');
    try {
        const res = await callApifetch('getLocations', 'location-list-none');
        locationList = res.ok ? (res.locations || []) : [];
        renderLocationList();
    } catch (err) {
        console.error('載入打卡地點失敗:', err);
        status.textContent = t('NOTIF_SUBMIT_FAILED');
    }
}

function renderLocationList() {
    const list = document.getElementById('location-list');
    const status = document.getElementById('location-list-status');
    list.innerHTML = '';
    status.textContent = locationList.length ? '' : t('LOCATION_LIST_EMPTY');

    locationList.forEach(loc => {
        const lat = Number(loc.lat), lng = Number(loc.lng), radius = Number(loc.radius || loc.scope) || 0;
        // 範圍互相重疊的地點容易把打卡記成隔壁那個，列出來提醒管理員
        const overlaps = locationList
            .filter(o => o !== loc && distanceMeters(lat, lng, Number(o.lat), Number(o.lng)) < radius + (Number(o.radius || o.scope) || 0))
            .map(o => o.name);

        const li = document.createElement('li');
        li.className = 'p-4 bg-gray-50 dark:bg-gray-700 rounded-lg' +
            (editingLocation && editingLocation.row === loc.row ? ' ring-2 ring-amber-400' : '');
        li.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-semibold text-gray-800 dark:text-white break-words">${escapeHtml(loc.name)}</p>
                    <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        ${lat.toFixed(6)}, ${lng.toFixed(6)}
                        ・${escapeHtml(t('LOCATION_RADIUS_VALUE', { radius }))}
                        ・<a href="https://www.google.com/maps?q=${lat},${lng}" target="_blank" rel="noopener"
                             class="text-indigo-600 dark:text-indigo-400 underline">${escapeHtml(t('LOCATION_VIEW_MAP'))}</a>
                    </p>
                    ${overlaps.length ? `<p class="text-xs text-amber-700 dark:text-amber-400 mt-1">${escapeHtml(t('LOCATION_OVERLAP_WARNING', { names: overlaps.join('、') }))}</p>` : ''}
                </div>
                <div class="flex gap-2 shrink-0">
                    <button data-act="edit" class="px-3 py-1 rounded-md text-sm font-bold btn-secondary">${escapeHtml(t('SHEET_ADMIN_EDIT'))}</button>
                    <button data-act="delete" class="px-3 py-1 rounded-md text-sm font-bold btn-warning">${escapeHtml(t('SHEET_ADMIN_DELETE'))}</button>
                </div>
            </div>
        `;
        li.querySelector('[data-act="edit"]').addEventListener('click', () => startEditLocation(loc));
        li.querySelector('[data-act="delete"]').addEventListener('click', (e) => deleteLocation(loc, e.currentTarget));
        list.appendChild(li);
    });
}

/** 把地點帶進表單，進入編輯模式 */
function startEditLocation(loc) {
    editingLocation = loc;
    const radius = Number(loc.radius || loc.scope) || 200;
    document.getElementById('location-name').value = loc.name;
    document.getElementById('location-search').value = '';
    const slider = document.getElementById('location-radius');
    slider.value = radius;
    document.getElementById('radius-value').textContent = slider.value;
    setPickerLocation(Number(loc.lat), Number(loc.lng));

    const banner = document.getElementById('location-editing-banner');
    banner.textContent = t('LOCATION_EDITING', { name: loc.name });
    banner.style.display = 'block';
    const addBtn = document.getElementById('add-location-btn');
    addBtn.textContent = t('LOCATION_SAVE_EDIT');
    addBtn.disabled = false;
    document.getElementById('cancel-edit-location-btn').style.display = 'block';

    renderLocationList();
    document.getElementById('location-admin-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** 回到新增模式，清空表單 */
function resetLocationForm() {
    editingLocation = null;
    ['location-name', 'location-lat', 'location-lng', 'location-search'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const slider = document.getElementById('location-radius');
    if (slider) slider.value = 200;
    const value = document.getElementById('radius-value');
    if (value) value.textContent = '200';
    const banner = document.getElementById('location-editing-banner');
    if (banner) banner.style.display = 'none';
    const addBtn = document.getElementById('add-location-btn');
    if (addBtn) {
        addBtn.textContent = t('ADD_LOCATION_BTN');
        addBtn.disabled = true;
    }
    const cancel = document.getElementById('cancel-edit-location-btn');
    if (cancel) cancel.style.display = 'none';
    renderLocationList();
}

/**
 * 新增或儲存編輯（新增地點按鈕呼叫）
 * @returns {Promise<boolean>} 是否成功
 */
async function saveLocationForm() {
    const name = document.getElementById('location-name').value.trim();
    const lat = document.getElementById('location-lat').value;
    const lng = document.getElementById('location-lng').value;
    const radius = document.getElementById('location-radius').value;

    if (!name || !lat || !lng) {
        showNotification(t('NOTIF_FILL_ALL_AND_LOCATION'), 'error');
        return false;
    }

    const btn = document.getElementById('add-location-btn');
    generalButtonState(btn, 'processing', t('LOADING'));
    try {
        const params = new URLSearchParams({ name, lat, lng, radius });
        let res;
        if (editingLocation) {
            params.set('row', editingLocation.row);
            params.set('origName', editingLocation.name);
            params.set('origLat', editingLocation.lat);
            params.set('origLng', editingLocation.lng);
            res = await callApifetch(`updateLocation&${params.toString()}`);
        } else {
            res = await callApifetch(`addLocation&${params.toString()}`);
        }

        if (res.ok) {
            showNotification(t(editingLocation ? 'LOCATION_UPDATE_SUCCESS' : 'NOTIF_LOCATION_ADDED'), 'success');
            generalButtonState(btn, 'idle');
            resetLocationForm();
            loadLocationList();
            return true;
        }
        showNotification(t(res.code || 'UNKNOWN_ERROR'), 'error');
        if (res.code === 'ERR_ROW_CHANGED') {
            generalButtonState(btn, 'idle');
            resetLocationForm();
            loadLocationList();
        }
        return false;
    } catch (err) {
        console.error('儲存打卡地點失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
        return false;
    } finally {
        if (btn.disabled && btn.dataset.originalText) generalButtonState(btn, 'idle');
    }
}

async function deleteLocation(loc, button) {
    if (!confirm(t('LOCATION_DELETE_CONFIRM', { name: loc.name }))) return;
    generalButtonState(button, 'processing', '…');
    try {
        const params = new URLSearchParams({ row: loc.row, origName: loc.name, origLat: loc.lat, origLng: loc.lng });
        const res = await callApifetch(`deleteLocation&${params.toString()}`);
        showNotification(t(res.code || 'UNKNOWN_ERROR'), res.ok ? 'success' : 'error');
        if (res.ok || res.code === 'ERR_ROW_CHANGED') {
            // 刪除後下面的列號都會變，編輯中的地點列號可能已經不對，所以退出編輯模式再重新載入
            if (editingLocation) resetLocationForm();
            loadLocationList();
        }
    } catch (err) {
        console.error('刪除打卡地點失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
    } finally {
        if (button.isConnected) generalButtonState(button, 'idle');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cancel-edit-location-btn')?.addEventListener('click', resetLocationForm);
    document.getElementById('refresh-location-list-btn')?.addEventListener('click', loadLocationList);
});
