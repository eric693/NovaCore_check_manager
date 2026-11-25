// 共用小工具：本地日期、HTML 跳脫、正式版的 log 控制
// 這支要在其他腳本之前載入。

// ===== 除錯輸出 =====
// 正式環境把 console.log/debug/info 關掉：原本會印出 token 前綴、部門、
// 薪資欄位等資訊。warn 與 error 保留，出事時仍看得到。
const DEBUG_MODE = (() => {
    try {
        if (localStorage.getItem('debug') === '1') return true;
    } catch {}
    return ['localhost', '127.0.0.1'].includes(location.hostname);
})();

if (!DEBUG_MODE) {
    console.log = () => {};
    console.debug = () => {};
    console.info = () => {};
}

// ===== 本地日期 =====
// toISOString() 是 UTC，台灣時間 00:00-08:00 之間切出來的日期會變成前一天，
// 早班與大夜班的「今日排班」「今天」因此全部抓錯，所以一律走這兩個函式。

/**
 * 依使用者所在時區把 Date 轉成 YYYY-MM-DD
 */
function toLocalDateStr(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 今天（本地時區）的 YYYY-MM-DD
 */
function todayStr() {
    return toLocalDateStr(new Date());
}

// ===== HTML 跳脫 =====
// 公告內容、請假／加班原因、姓名等都是使用者填的，直接內插進 innerHTML
// 會變成儲存型 XSS——員工在原因欄放 <img onerror> 就能在管理員的瀏覽器執行。

/**
 * 跳脫 HTML 特殊字元，用於內插進 innerHTML 的文字
 */
function escapeHtml(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[&<>"']/g, c => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[c]));
}

/**
 * 要放進 onclick="fn('...')" 這種行內事件的字串。
 * 屬性值會先被 HTML 解碼再交給 JS 解析，所以要先做 JS 字串跳脫再做 HTML 跳脫，
 * 否則姓名裡的單引號就能跳出字串執行任意程式碼。
 */
function escapeJsAttr(value) {
    const js = String(value === null || value === undefined ? '' : value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r?\n/g, '\\n');
    return escapeHtml(js);
}

/**
 * 按鈕的處理中／閒置狀態切換。
 * 原本 overtime.js 與 script.js 各有一份，而 script.js 裡那份宣告在
 * DOMContentLoaded 內，檔案層級的 doPunch()、匯出函式其實是用到 overtime.js 的版本，
 * 也就是 salary.html（沒載 overtime.js）一按就會 ReferenceError。統一放這裡。
 */
function generalButtonState(button, state, loadingText) {
    if (!button) return;
    const loadingClasses = 'opacity-50 cursor-not-allowed';
    const text = loadingText || (typeof t === 'function' ? t('NOTIF_PROCESSING') : '處理中...');

    if (state === 'processing') {
        button.dataset.originalText = button.textContent;
        button.dataset.loadingClasses = loadingClasses;
        button.disabled = true;
        button.textContent = text;
        button.classList.add(...loadingClasses.split(' '));
    } else {
        if (button.dataset.loadingClasses) {
            button.classList.remove(...button.dataset.loadingClasses.split(' '));
        }
        button.disabled = false;
        if (button.dataset.originalText) {
            button.textContent = button.dataset.originalText;
            delete button.dataset.originalText;
        }
    }
}

// ===== DOM 小幫手 =====
// script.js 同時被 index.html 與 salary.html 載入，但登入相關的元素只有 index.html 有。
// 直接 document.getElementById(...).textContent = ... 會在 salary.html 丟 TypeError，
// 而且是在 DOMContentLoaded 裡面丟，後面的初始化會整段中止。

/** 設定元素文字；元素不存在就跳過 */
function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
    return el;
}

/** 設定元素的 style.display；元素不存在就跳過 */
function setElementDisplay(id, display) {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
    return el;
}

/** 設定圖片來源；元素不存在就跳過 */
function setElementSrc(id, src) {
    const el = document.getElementById(id);
    if (el) el.src = src;
    return el;
}

// ===== 定位 =====
// getCurrentPosition() 不帶參數時 enableHighAccuracy 是 false，手機會用基地台／Wi-Fi 粗估，
// 誤差動輒幾百公尺到幾公里，座標落進隔壁客戶的範圍，打卡紀錄的地點就記錯。
// 而且第一個回報的點通常最不準（GPS 還沒鎖定），所以持續監聽一小段時間取誤差最小的那筆。

/**
 * 取得盡量精確的目前位置
 *
 * 同時跑兩條路：
 *   - GPS 高精度持續監聽（watchPosition）：準，但室內、LINE 內建瀏覽器常常十幾秒鎖不到
 *   - 低精度一次定位（Wi-Fi／基地台）：幾秒內就有，可接受一分鐘內的快取位置
 * 有夠準的（≤ goodEnough）就立刻用；過了 settleAfter 還沒有，但手上已有 ≤ 100m 的也先用；
 * 到 maxWait 就用目前最好的那一筆。後端會再檢查誤差，太大會請員工重新定位。
 *
 * 原本只跑 GPS、12 秒逾時，而且定位一開始常見的「暫時無法定位」錯誤會立刻放棄，
 * 員工在室內就一直顯示「位置請求超時」。
 *
 * @param {Object} [opts]
 * @param {number} [opts.goodEnough=30] 誤差（公尺）小於這個值就立刻回傳
 * @param {number} [opts.maxWait=20000] 最多等多久（毫秒）
 * @param {number} [opts.settleAfter=6000] 過了這麼久，已有 ≤ 100m 的位置就不再等
 * @returns {Promise<{latitude:number, longitude:number, accuracy:number}>}
 *          失敗時 reject 的錯誤帶有 code（1 權限、2 無法定位、3 逾時），與原生 GeolocationPositionError 相同
 */
function getAccuratePosition({ goodEnough = 30, maxWait = 20000, settleAfter = 6000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            const err = new Error('Geolocation not supported');
            err.code = 2;
            reject(err);
            return;
        }

        const startedAt = Date.now();
        let best = null;
        let watchId = null;
        let settled = false;
        let lastError = null;
        let failedChannels = 0;   // GPS 與 Wi-Fi 兩條路都失敗就不用等到 maxWait
        const timers = [];

        const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            if (watchId !== null) navigator.geolocation.clearWatch(watchId);
            timers.forEach(clearTimeout);
            fn(value);
        };
        const giveUp = () => finish(reject, lastError && lastError.code !== 3
            ? lastError
            : Object.assign(new Error('Location timeout'), { code: 3 }));
        const done = () => best ? finish(resolve, best) : giveUp();

        const consider = (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            if (!best || accuracy < best.accuracy) best = { latitude, longitude, accuracy };
            if (best.accuracy <= goodEnough) return done();
            if (Date.now() - startedAt >= settleAfter && best.accuracy <= 100) return done();
        };
        const onError = (err) => {
            // 拒絕權限再等也沒用；其他錯誤（暫時無法定位、單次逾時）先記著，繼續等另一條路
            if (err && err.code === 1) return finish(reject, err);
            lastError = err;
            if (++failedChannels >= 2 && !best) giveUp();
        };

        timers.push(setTimeout(done, maxWait));
        // 到了 settleAfter 再檢查一次（期間可能沒有新的定位更新觸發 consider）
        timers.push(setTimeout(() => { if (best && best.accuracy <= 100) done(); }, settleAfter));

        watchId = navigator.geolocation.watchPosition(consider, onError,
            { enableHighAccuracy: true, maximumAge: 0 });
        navigator.geolocation.getCurrentPosition(consider, onError,
            { enableHighAccuracy: false, maximumAge: 60000, timeout: maxWait });
    });
}

/**
 * 定位錯誤轉成給使用者看的訊息
 */
function geolocationErrorMessage(err) {
    const tr = (key, fallback) => {
        const s = typeof t === 'function' ? t(key) : key;
        return s && s !== key ? s : fallback;
    };
    switch (err && err.code) {
        case 1: return tr('ERROR_GEOLOCATION_PERMISSION_DENIED', '請允許瀏覽器存取位置');
        // 逾時、無法定位時一併告訴員工怎麼處理，不然只會一直重按
        case 3: return tr('ERROR_GEOLOCATION_TIMEOUT', '定位逾時') + ' ' + tr('GEO_RETRY_HINT', '');
        default: return tr('ERROR_GEOLOCATION_UNAVAILABLE', '目前無法取得位置') + ' ' + tr('GEO_RETRY_HINT', '');
    }
}
