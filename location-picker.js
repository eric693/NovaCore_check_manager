// 打卡地點：Nominatim 地址搜尋 + 可拖曳微調的選取器地圖
// 從 script.js 拆出，只依賴 utils.js / i18n.js / libs.js 與 showNotification()。

// ==================== 地點搜尋功能 ====================

/**
 * 使用 Nominatim API 搜尋地點
 */
async function searchLocation(query) {
    if (!query || query.trim() === '') {
        return [];
    }
    
    // 先限定台灣搜尋（門牌與路段的命中率較高），沒有結果再放寬到全球
    const request = async (countryCode) => {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}`
            + `&limit=5&accept-language=zh-TW${countryCode ? '&countrycodes=' + countryCode : ''}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error('搜尋失敗');
        return await response.json();
    };
    
    try {
        let results = await request('tw');
        if (!results.length) results = await request('');
        return results;
        
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
    
    resultsContainer.classList.remove('hidden');
    
    results.forEach(result => {
        const li = document.createElement('li');
        li.className = 'text-sm text-gray-800 dark:text-gray-200';
        li.innerHTML = `
            <div class="font-semibold">${escapeHtml(result.display_name)}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
                ${parseFloat(result.lat).toFixed(6)}, ${parseFloat(result.lon).toFixed(6)}
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
    
    if (nameInput) nameInput.value = result.display_name.split(',')[0].trim();
    if (latInput) latInput.value = parseFloat(result.lat).toFixed(6);
    if (lngInput) lngInput.value = parseFloat(result.lon).toFixed(6);
    if (addBtn) addBtn.disabled = false;
    if (resultsContainer) resultsContainer.classList.add('hidden');
    
    // 在下方小地圖標出這個點，之後可以拖曳微調
    setPickerLocation(parseFloat(result.lat), parseFloat(result.lon));
    
    showNotification(t('NOTIF_LOCATION_PICKED'), 'success');
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
