// 第三方函式庫延遲載入
// Chart.js、Leaflet、SheetJS 只有特定分頁用得到（分析圖表、地圖、匯出報表），
// 原本三支都寫在 <head> 一律下載，手機端首屏白等。改成真的要用時才載，
// 同一支只會載入一次，重複呼叫會共用同一個 Promise。

const LIB_SOURCES = {
    chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
    leaflet: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    xlsx: 'https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js'
};

// 已經有全域物件就不用再載（例如頁面自己用 <script> 掛過）
const LIB_GLOBALS = {
    chart: () => typeof Chart !== 'undefined',
    leaflet: () => typeof L !== 'undefined',
    xlsx: () => typeof XLSX !== 'undefined'
};

const _libPromises = {};

/**
 * 確保指定的函式庫已載入。
 * @param {'chart'|'leaflet'|'xlsx'} name
 * @returns {Promise<void>}
 */
function ensureLib(name) {
    const src = LIB_SOURCES[name];
    if (!src) return Promise.reject(new Error(`未知的函式庫: ${name}`));
    if (LIB_GLOBALS[name]()) return Promise.resolve();
    if (_libPromises[name]) return _libPromises[name];
    
    _libPromises[name] = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => {
            delete _libPromises[name]; // 讓下次還能重試
            reject(new Error(`載入失敗: ${src}`));
        };
        document.head.appendChild(script);
    });
    
    return _libPromises[name];
}
