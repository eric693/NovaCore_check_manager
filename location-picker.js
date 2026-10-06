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
