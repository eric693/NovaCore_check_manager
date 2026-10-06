// 資料管理頁（data-admin.html）：管理員直接查看、新增、編輯、刪除試算表資料
// 後端：GS/SheetAdmin.gs（sheetAdminList / sheetAdminGet / sheetAdminSave / sheetAdminDelete）
// - 「打卡紀錄」有專用的查詢表單與欄位顯示
// - 其他分頁共用 SheetTable 元件：搜尋、欄位篩選、排序、分頁、新增／編輯／刪除
// 讀取的資料一次載入，篩選與排序都在瀏覽器做，切換條件不用等後端。

window.I18N_TITLE_KEY = 'DATA_ADMIN_PAGE_TITLE';

const DA_PAGE_SIZE = 50;
const DA_TIMEOUT_MS = 30000;

// 打卡紀錄欄位（GS/DbOperations.gs punch() 寫入的順序）
const ATT = { TIME: 0, USER_ID: 1, DEPT: 2, NAME: 3, TYPE: 4, GPS: 5, LOCATION: 6, NOTE: 7, AUDIT: 8, DEVICE: 9 };

// 預設分頁對應的工作表；系統不同版本用過不同名稱，挑第一個存在且有資料的
const DA_TAB_SHEETS = {
    leaveBalance: ['員工假期額度', '假期餘額'],
    leave: ['請假紀錄', '請假申請'],
    overtime: ['加班申請', '加班紀錄']
};

// ==================== 小工具 ====================

/** t() 找不到翻譯時用中文預設字串 */
function tr(key, params, fallback) {
    const s = typeof t === 'function' ? t(key, params || {}) : key;
    if (s !== key) return s;
    let text = fallback || key;
    Object.keys(params || {}).forEach(k => { text = text.replace(`{${k}}`, params[k]); });
    return text;
}

let _toastTimer = null;
function toast(message, type = 'success') {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.className = `toast show ${type}`;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

async function daFetch(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DA_TIMEOUT_MS);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

const daApi = {
    get(action, params = {}) {
        const qs = new URLSearchParams({ action, token: localStorage.getItem('sessionToken') || '', ...params });
        return daFetch(`${API_CONFIG.apiUrl}?${qs}`);
    },
    // 寫入用 POST：整列資料放網址可能超過長度限制，也不該留在存取紀錄裡
    post(action, params = {}) {
        const body = new URLSearchParams({ action, token: localStorage.getItem('sessionToken') || '', ...params });
        return daFetch(API_CONFIG.apiUrl, { method: 'POST', body });
    }
};

function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v === true ? '' : v);
    });
    [].concat(children).forEach(c => c !== null && c !== undefined && node.append(c));
    return node;
}

function busy(button, on) {
    if (!button) return;
    if (on) {
        button.dataset.label = button.textContent;
        button.textContent = tr('LOADING', {}, '處理中...');
        button.disabled = true;
    } else {
        button.disabled = false;
        if (button.dataset.label) button.textContent = button.dataset.label;
    }
}

/** 數字或日期字串（yyyy-MM-dd…）可以直接比大小；其他用字串比 */
function daCompare(a, b) {
    const na = Number(String(a).replace(/,/g, ''));
    const nb = Number(String(b).replace(/,/g, ''));
    if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });
}

/**
 * 共用的表單對話框
 * @param {string} title
 * @param {HTMLElement[]} fields
 * @param {(btn: HTMLButtonElement) => Promise<boolean>} onSave 回傳 true 就關閉
 */
function openModal(title, fields, onSave) {
    const backdrop = el('div', { class: 'modal-backdrop' });
    const save = el('button', { class: 'btn btn-primary', type: 'button', text: tr('SHEET_ADMIN_SAVE', {}, '儲存') });
    const cancel = el('button', { class: 'btn btn-soft', type: 'button', text: tr('SHEET_ADMIN_CANCEL', {}, '取消'), onclick: () => backdrop.remove() });
    backdrop.append(el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' }, [
        el('header', { text: title }),
        el('div', { class: 'body' }, fields),
        el('footer', {}, [cancel, save])
    ]));
    save.addEventListener('click', async () => {
        busy(save, true);
        try {
            if (await onSave(save)) backdrop.remove();
        } catch (err) {
            console.error(err);
            toast(tr('NOTIF_SUBMIT_FAILED', {}, '送出失敗，請稍後再試'), 'error');
        } finally {
            if (save.isConnected) busy(save, false);
        }
    });
    document.body.append(backdrop);
    setTimeout(() => backdrop.querySelector('input, select, textarea')?.focus(), 50);
    return backdrop;
}

function field(labelText, input, { hint, full } = {}) {
    if (!input.id) input.id = 'f-' + Math.random().toString(36).slice(2, 9);
    return el('div', { class: 'field' + (full ? ' full' : '') }, [
        el('label', { for: input.id, text: labelText }),
        input,
        hint ? el('div', { class: 'hint', text: hint }) : null
    ]);
}

/** 存檔／刪除的共通結果處理；回傳是否成功 */
function handleWriteResult(res, onReload) {
    toast(tr(res.code || 'UNKNOWN_ERROR', res.params || {}, res.msg || '操作失敗'), res.ok ? 'success' : 'error');
    // 列號有變（別人改過、或刪了上面的列）也要重新載入，才拿得到最新的列號與內容
    if (res.ok || res.code === 'ERR_ROW_CHANGED') onReload();
    return !!res.ok || res.code === 'ERR_ROW_CHANGED';
}

// ==================== 共用資料 ====================

const shared = {
    sheets: null,       // [{ name, rows, readonly }]
    employees: null,    // [{ userId, name, dept }]
    locations: null     // ['地點名稱']
};

async function loadSheetList(force) {
    if (shared.sheets && !force) return shared.sheets;
    const res = await daApi.get('sheetAdminList');
    if (!res.ok) throw Object.assign(new Error(res.code), { code: res.code });
    shared.sheets = res.sheets || [];
    return shared.sheets;
}

async function loadEmployees() {
    if (shared.employees) return shared.employees;
    try {
        const res = await daApi.get('sheetAdminGet', { sheet: '員工名單' });
        // 員工名單：A userId、C LINE 名稱、F 部門、I 手動設定的姓名（優先）
        shared.employees = res.ok ? res.rows
            .map(r => ({ userId: r.values[0], name: r.values[8] || r.values[2] || r.values[0], dept: r.values[5] || '' }))
            .filter(e => e.userId) : [];
    } catch (err) {
        console.warn('載入員工名單失敗:', err);
        shared.employees = [];
    }
    return shared.employees;
}

async function loadLocations() {
    if (shared.locations) return shared.locations;
    try {
        const res = await daApi.get('getLocations');
        shared.locations = res.ok ? (res.locations || []).map(l => l.name).filter(Boolean) : [];
    } catch (err) {
        shared.locations = [];
    }
    return shared.locations;
}

// ==================== 打卡紀錄分頁 ====================

const attendance = {
    data: null,   // sheetAdminGet 回應
    loading: null
};

function deviceLabel(text) {
    const s = String(text || '');
    if (!s) return '';
    // 網頁打卡存的是整串 User-Agent，只留看得懂的裝置名稱
    if (/Mozilla\/|AppleWebKit|Chrome\//.test(s)) {
        const line = /Line\//.test(s) ? ' (LINE)' : '';
        if (/iPhone|iPad/.test(s)) return 'iPhone' + line;
        if (/Android/.test(s)) return 'Android' + line;
        if (/Windows|Macintosh|Linux/.test(s)) return tr('DATA_ADMIN_DEVICE_COMPUTER', {}, '電腦') + line;
        return tr('DATA_ADMIN_DEVICE_BROWSER', {}, '瀏覽器') + line;
    }
    return s;
}

async function initAttendanceTab() {
    const start = document.getElementById('att-start');
    const end = document.getElementById('att-end');
    const now = new Date();
    start.value = toLocalDateStr(new Date(now.getFullYear(), now.getMonth(), 1));
    end.value = toLocalDateStr(now);

    document.getElementById('att-query').addEventListener('click', (e) => queryAttendance(true, e.currentTarget));
    document.getElementById('att-add').addEventListener('click', () => openPunchEditor(null));
    document.getElementById('att-employee').addEventListener('change', () => queryAttendance(false));

    const employees = await loadEmployees();
    const select = document.getElementById('att-employee');
    select.innerHTML = '';
    select.append(new Option(tr('DATA_ADMIN_ALL', {}, '全部'), ''));
    employees.forEach(emp => select.append(new Option(emp.name, emp.userId)));

    queryAttendance(true);
}

async function loadAttendance(force) {
    if (attendance.data && !force) return attendance.data;
    if (!attendance.loading) {
        attendance.loading = daApi.get('sheetAdminGet', { sheet: '打卡紀錄' })
            .finally(() => { attendance.loading = null; });
    }
    const res = await attendance.loading;
    if (!res.ok) throw Object.assign(new Error(res.code), { code: res.code });
    attendance.data = res;
    return res;
}

async function queryAttendance(reload, button) {
    const tbody = document.getElementById('att-tbody');
    const count = document.getElementById('att-count');
    const start = document.getElementById('att-start').value;
    const end = document.getElementById('att-end').value;
    const userId = document.getElementById('att-employee').value;

    if (start && end && start > end) {
        toast(tr('DATA_ADMIN_BAD_RANGE', {}, '開始日期不能晚於結束日期'), 'warning');
        return;
    }

    busy(button, true);
    if (reload) {
        tbody.innerHTML = '';
        tbody.append(el('tr', {}, el('td', { colspan: 8, class: 'empty', text: tr('LOADING', {}, '載入中...') })));
    }
    try {
        const data = await loadAttendance(reload);
        const rows = data.rows
            .filter(r => {
                const day = String(r.values[ATT.TIME] || '').slice(0, 10);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
                if (start && day < start) return false;
                if (end && day > end) return false;
                return !userId || r.values[ATT.USER_ID] === userId;
            })
            .sort((a, b) => String(a.values[ATT.TIME]).localeCompare(String(b.values[ATT.TIME])));

        count.textContent = tr('DATA_ADMIN_TOTAL', { n: rows.length }, '共 {n} 筆');
        renderAttendanceRows(rows);
    } catch (err) {
        console.error('查詢打卡紀錄失敗:', err);
        tbody.innerHTML = '';
        toast(tr(err.code || 'NOTIF_SUBMIT_FAILED', {}, '載入失敗，請稍後再試'), 'error');
    } finally {
        busy(button, false);
    }
}

function renderAttendanceRows(rows) {
    const tbody = document.getElementById('att-tbody');
    tbody.innerHTML = '';
    if (!rows.length) {
        tbody.append(el('tr', {}, el('td', { colspan: 8, class: 'empty', text: tr('SHEET_ADMIN_NO_ROWS', {}, '沒有符合的資料') })));
        return;
    }

    let lastDay = null;
    rows.forEach(r => {
        const v = r.values;
        const stamp = String(v[ATT.TIME] || '');
        const day = stamp.slice(0, 10);
        const time = stamp.slice(11, 16);
        const isIn = v[ATT.TYPE] === '上班';
        const note = String(v[ATT.NOTE] || '');
        const adjusted = note === '補打卡';
        // 備註欄：補打卡已經顯示在狀態，其他備註（例如 LINE Bot、QR打卡）和裝置一起列出
        // LINE 打卡的備註固定是「LINE Bot」、裝置是「LINE Official Account」，重複的就只留裝置
        const device = deviceLabel(v[ATT.DEVICE]);
        const noteShown = adjusted || (note === 'LINE Bot' && /LINE/.test(device)) ? '' : note;
        const remark = [noteShown, device].filter(Boolean).join('・');

        const firstOfDay = day !== lastDay;
        lastDay = day;

        tbody.append(el('tr', { class: firstOfDay ? 'group-start' : '' }, [
            el('td', { class: 'date-cell', text: firstOfDay ? day : '' }),
            el('td', { class: 'num', text: time }),
            el('td', { class: 'nowrap', text: v[ATT.NAME] || v[ATT.USER_ID] || '' }),
            el('td', {}, el('span', {
                class: 'badge ' + (isIn ? 'badge-in' : 'badge-out'),
                text: tr(isIn ? 'PUNCH_IN' : 'PUNCH_OUT', {}, v[ATT.TYPE] || '')
            })),
            el('td', { class: 'clip', title: v[ATT.LOCATION] || '', text: v[ATT.LOCATION] || '' }),
            el('td', {}, el('span', {
                class: 'badge ' + (adjusted ? 'badge-adj' : 'badge-normal'),
                text: adjusted ? tr('DATA_ADMIN_STATUS_ADJUSTED', {}, '補打卡') : tr('DATA_ADMIN_STATUS_NORMAL', {}, '一般')
            })),
            el('td', { class: 'clip', title: [note, v[ATT.DEVICE]].filter(Boolean).join('\n'), text: remark }),
            el('td', { class: 'row-actions' }, [
                el('button', { class: 'btn btn-soft btn-sm', text: tr('SHEET_ADMIN_EDIT', {}, '編輯'), onclick: () => openPunchEditor(r) }),
                el('button', { class: 'btn btn-danger btn-sm', text: tr('SHEET_ADMIN_DELETE', {}, '刪除'), onclick: (e) => deletePunch(r, e.currentTarget) })
            ])
        ]));
    });
}

async function openPunchEditor(row) {
    const [employees, locations] = await Promise.all([loadEmployees(), loadLocations()]);
    const data = await loadAttendance(false);
    const original = row ? row.values.slice() : null;
    const v = original || [];
    const stamp = String(v[ATT.TIME] || '');

    const date = el('input', { type: 'date', required: true, value: stamp.slice(0, 10) || todayStr() });
    const time = el('input', { type: 'time', required: true, value: stamp.slice(11, 16) || '' });

    const emp = el('select', { required: true });
    emp.append(new Option(tr('DATA_ADMIN_PICK_EMPLOYEE', {}, '請選擇員工'), ''));
    employees.forEach(e => emp.append(new Option(e.name, e.userId)));
    // 已離職（不在員工名單）的人仍要能編輯自己的舊紀錄
    if (v[ATT.USER_ID] && !employees.some(e => e.userId === v[ATT.USER_ID])) {
        emp.append(new Option(v[ATT.NAME] || v[ATT.USER_ID], v[ATT.USER_ID]));
    }
    emp.value = v[ATT.USER_ID] || '';

    const type = el('select');
    ['上班', '下班'].forEach(x => type.append(new Option(tr(x === '上班' ? 'PUNCH_IN' : 'PUNCH_OUT', {}, x), x)));
    type.value = v[ATT.TYPE] || '上班';

    const listId = 'da-locations';
    document.getElementById(listId)?.remove();
    document.body.append(el('datalist', { id: listId }, locations.map(name => el('option', { value: name }))));
    const loc = el('input', { type: 'text', list: listId, value: v[ATT.LOCATION] || '' });
    const note = el('input', { type: 'text', value: v[ATT.NOTE] || '' });

    const title = row
        ? tr('DATA_ADMIN_EDIT_PUNCH', { row: row.row }, '編輯打卡紀錄（第 {row} 列）')
        : tr('DATA_ADMIN_ADD_PUNCH', {}, '新增打卡');

    openModal(title, [
        field(tr('DATA_ADMIN_COL_DATE', {}, '日期'), date),
        field(tr('DATA_ADMIN_COL_TIME', {}, '時間'), time),
        field(tr('DATA_ADMIN_COL_EMPLOYEE', {}, '員工'), emp),
        field(tr('DATA_ADMIN_COL_TYPE', {}, '上班 / 下班'), type),
        field(tr('DATA_ADMIN_COL_LOCATION', {}, '地點'), loc, { full: true }),
        field(tr('DATA_ADMIN_COL_NOTE', {}, '備註'), note, { full: true, hint: tr('DATA_ADMIN_NOTE_HINT', {}, '填「補打卡」會顯示為補打卡狀態') })
    ], async () => {
        if (!date.value || !time.value || !emp.value) {
            toast(tr('DATA_ADMIN_REQUIRED', {}, '請填寫日期、時間與員工'), 'warning');
            return false;
        }
        const person = employees.find(e => e.userId === emp.value);
        const values = original ? original.slice() : new Array(data.headers.length).fill('');

        // 只改到分鐘的話保留原本的秒數，免得沒改時間也被當成修改
        const newStamp = `${date.value} ${time.value}`;
        values[ATT.TIME] = stamp.slice(0, 16) === newStamp ? stamp : `${newStamp}:00`;
        values[ATT.USER_ID] = emp.value;
        if (person) {
            values[ATT.DEPT] = person.dept;
            values[ATT.NAME] = person.name;
        }
        values[ATT.TYPE] = type.value;
        values[ATT.LOCATION] = loc.value.trim();
        values[ATT.NOTE] = note.value.trim();
        if (!original) values[ATT.DEVICE] = tr('DATA_ADMIN_ADDED_BY_ADMIN', {}, '管理員新增');

        const params = { sheet: '打卡紀錄', values: JSON.stringify(values) };
        if (row) {
            params.row = row.row;
            params.original = JSON.stringify(original);
        }
        const res = await daApi.post('sheetAdminSave', params);
        return handleWriteResult(res, () => queryAttendance(true));
    });
}

async function deletePunch(row, button) {
    const v = row.values;
    const summary = `${v[ATT.TIME]}  ${v[ATT.NAME] || v[ATT.USER_ID]}  ${v[ATT.TYPE]}  ${v[ATT.LOCATION] || ''}`;
    if (!confirm(tr('DATA_ADMIN_DELETE_PUNCH_CONFIRM', {}, '確定要刪除這筆打卡紀錄嗎？刪除後無法復原。') + '\n\n' + summary)) return;
    busy(button, true);
    try {
        const res = await daApi.post('sheetAdminDelete', { sheet: '打卡紀錄', row: row.row, original: JSON.stringify(v) });
        handleWriteResult(res, () => queryAttendance(true));
    } catch (err) {
        console.error(err);
        toast(tr('NOTIF_SUBMIT_FAILED', {}, '送出失敗，請稍後再試'), 'error');
    } finally {
        if (button.isConnected) busy(button, false);
    }
}

// ==================== 通用資料表元件 ====================

class SheetTable {
    /**
     * @param {HTMLElement} root 放元件的分頁
     * @param {{ candidates?: string[], picker?: boolean }} opts
     */
    constructor(root, opts) {
        this.root = root;
        this.opts = opts;
        this.data = null;
        this.filtered = [];
        this.search = '';
        this.filters = [];
        this.sort = null;
        this.page = 0;
        this.seq = 0;
        this.build();
    }

    build() {
        this.title = el('h2', { text: '' });
        this.picker = this.opts.picker ? el('select', { class: 'grow', onchange: () => this.load(this.picker.value) }) : null;
        this.searchInput = el('input', { type: 'search', class: 'grow', placeholder: tr('SHEET_ADMIN_SEARCH_PLACEHOLDER', {}, '搜尋所有欄位...') });
        let timer = null;
        this.searchInput.addEventListener('input', () => {
            clearTimeout(timer);
            timer = setTimeout(() => { this.search = this.searchInput.value.trim().toLowerCase(); this.page = 0; this.apply(); }, 200);
        });

        this.filterCol = el('select');
        this.filterOp = el('select');
        [['contains', tr('SHEET_ADMIN_OP_CONTAINS', {}, '包含')], ['eq', tr('SHEET_ADMIN_OP_EQ', {}, '等於')],
         ['neq', tr('SHEET_ADMIN_OP_NEQ', {}, '不等於')], ['gte', '≥'], ['lte', '≤'],
         ['empty', tr('SHEET_ADMIN_OP_EMPTY', {}, '是空白')], ['notempty', tr('SHEET_ADMIN_OP_NOTEMPTY', {}, '不是空白')]]
            .forEach(([value, label]) => this.filterOp.append(new Option(label, value)));
        this.filterVal = el('input', { type: 'text', class: 'grow', placeholder: tr('SHEET_ADMIN_FILTER_VALUE', {}, '篩選值') });
        this.filterVal.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.addFilter(); });
        const addFilterBtn = el('button', { class: 'btn btn-soft', text: tr('SHEET_ADMIN_FILTER_ADD', {}, '加入篩選'), onclick: () => this.addFilter() });

        this.refreshBtn = el('button', { class: 'btn btn-soft', text: tr('SHEET_ADMIN_REFRESH', {}, '重新整理'), onclick: () => this.reload() });
        this.addBtn = el('button', { class: 'btn btn-primary', text: tr('SHEET_ADMIN_ADD', {}, '新增資料'), onclick: () => this.openEditor(null), disabled: true });

        this.chips = el('div', { class: 'chips' });
        this.count = el('div', { class: 'count' });
        this.thead = el('thead');
        this.tbody = el('tbody');
        this.prev = el('button', { class: 'btn btn-soft btn-sm', text: tr('SHEET_ADMIN_PREV', {}, '上一頁'), onclick: () => { this.page--; this.render(); } });
        this.next = el('button', { class: 'btn btn-soft btn-sm', text: tr('SHEET_ADMIN_NEXT', {}, '下一頁'), onclick: () => { this.page++; this.render(); } });
        this.pageLabel = el('span');
        this.pager = el('div', { class: 'pager', style: 'display:none' }, [this.prev, this.pageLabel, this.next]);

        this.root.append(
            el('div', { class: 'card' }, [
                this.title,
                el('div', { class: 'toolbar' }, [this.picker, this.searchInput, this.refreshBtn, this.addBtn].filter(Boolean)),
                el('div', { class: 'toolbar' }, [this.filterCol, this.filterOp, this.filterVal, addFilterBtn]),
                this.chips
            ]),
            el('div', { class: 'card' }, [
                this.count,
                el('div', { class: 'table-wrap' }, el('table', {}, [this.thead, this.tbody])),
                this.pager
            ])
        );
    }

    async init() {
        if (this.inited) return;
        this.inited = true;
        try {
            const sheets = await loadSheetList();
            if (this.opts.picker) {
                this.picker.innerHTML = '';
                this.picker.append(new Option(tr('SHEET_ADMIN_PICK', {}, '請選擇工作表'), ''));
                sheets.forEach(s => this.picker.append(new Option(`${s.name}（${s.rows}）${s.readonly ? ' 🔒' : ''}`, s.name)));
                this.title.textContent = tr('DATA_ADMIN_TAB_ALL', {}, '所有資料表');
                this.showMessage(tr('SHEET_ADMIN_PICK', {}, '請選擇工作表'));
                return;
            }
            const existing = this.opts.candidates.map(n => sheets.find(s => s.name === n)).filter(Boolean);
            const target = existing.find(s => s.rows > 0) || existing[0];
            if (!target) {
                this.title.textContent = this.opts.candidates[0];
                this.showMessage(tr('DATA_ADMIN_SHEET_MISSING', { name: this.opts.candidates.join('／') }, '找不到工作表：{name}'));
                return;
            }
            this.load(target.name);
        } catch (err) {
            this.inited = false;
            toast(tr(err.code || 'NOTIF_SUBMIT_FAILED', {}, '載入失敗，請稍後再試'), 'error');
        }
    }

    showMessage(text) {
        this.thead.innerHTML = '';
        this.tbody.innerHTML = '';
        this.tbody.append(el('tr', {}, el('td', { class: 'empty', text })));
        this.count.textContent = '';
        this.pager.style.display = 'none';
    }

    reload() {
        if (this.data) this.load(this.data.name, true);
        else this.init();
    }

    async load(name, keepView) {
        const seq = ++this.seq;
        if (!keepView) {
            this.search = ''; this.searchInput.value = '';
            this.filters = []; this.sort = null; this.page = 0;
        }
        if (!name) { this.data = null; this.addBtn.disabled = true; this.showMessage(tr('SHEET_ADMIN_PICK', {}, '請選擇工作表')); return; }

        this.title.textContent = name;
        if (!keepView) this.showMessage(tr('LOADING', {}, '載入中...'));
        busy(this.refreshBtn, true);
        try {
            const res = await daApi.get('sheetAdminGet', { sheet: name });
            if (seq !== this.seq) return;
            if (!res.ok) { toast(tr(res.code || 'UNKNOWN_ERROR', {}, '載入失敗'), 'error'); return; }
            this.data = res;
            this.addBtn.disabled = !!res.readonly || !res.headers.length;
            this.filterCol.innerHTML = '';
            res.headers.forEach((h, i) => this.filterCol.append(new Option(h, String(i))));
            this.apply();
        } catch (err) {
            if (seq !== this.seq) return;
            console.error('載入工作表失敗:', err);
            toast(tr('NOTIF_SUBMIT_FAILED', {}, '載入失敗，請稍後再試'), 'error');
        } finally {
            if (seq === this.seq) busy(this.refreshBtn, false);
        }
    }

    addFilter() {
        if (!this.data) return;
        const col = parseInt(this.filterCol.value, 10);
        const op = this.filterOp.value;
        const value = this.filterVal.value.trim();
        if (isNaN(col)) return;
        if (!['empty', 'notempty'].includes(op) && value === '') {
            toast(tr('SHEET_ADMIN_FILTER_NEED_VALUE', {}, '請輸入篩選值'), 'warning');
            return;
        }
        this.filters.push({ col, op, value });
        this.filterVal.value = '';
        this.page = 0;
        this.apply();
    }

    static match(cell, f) {
        const v = String(cell ?? '');
        const lv = v.toLowerCase();
        const fv = f.value.toLowerCase();
        switch (f.op) {
            case 'contains': return lv.includes(fv);
            case 'eq': return lv === fv;
            case 'neq': return lv !== fv;
            case 'gte': return v !== '' && daCompare(v, f.value) >= 0;
            case 'lte': return v !== '' && daCompare(v, f.value) <= 0;
            case 'empty': return v === '';
            case 'notempty': return v !== '';
            default: return true;
        }
    }

    apply() {
        const d = this.data;
        if (!d) return;
        let rows = d.rows;
        if (this.search) rows = rows.filter(r => r.values.some(v => String(v).toLowerCase().includes(this.search)));
        this.filters.forEach(f => { rows = rows.filter(r => SheetTable.match(r.values[f.col], f)); });
        if (this.sort) {
            const { col, dir } = this.sort;
            rows = rows.slice().sort((a, b) => dir * daCompare(a.values[col] ?? '', b.values[col] ?? ''));
        }
        this.filtered = rows;
        this.renderChips();
        this.count.textContent = tr('SHEET_ADMIN_COUNT', { total: d.rows.length, shown: rows.length }, '共 {total} 筆，符合 {shown} 筆');
        this.render();
    }

    renderChips() {
        this.chips.innerHTML = '';
        const label = Object.fromEntries([...this.filterOp.options].map(o => [o.value, o.textContent]));
        this.filters.forEach((f, i) => {
            this.chips.append(el('span', { class: 'chip' }, [
                `${this.data.headers[f.col]} ${label[f.op]} ${f.value}`.trim(),
                el('button', {
                    type: 'button', text: '×', 'aria-label': tr('SHEET_ADMIN_REMOVE_FILTER', {}, '移除篩選'),
                    onclick: () => { this.filters.splice(i, 1); this.page = 0; this.apply(); }
                })
            ]));
        });
    }

    render() {
        const d = this.data;
        const editable = !d.readonly;
        const pages = Math.max(1, Math.ceil(this.filtered.length / DA_PAGE_SIZE));
        this.page = Math.min(Math.max(this.page, 0), pages - 1);

        // 表頭：點欄名排序（升冪 → 降冪 → 不排序）
        const arrow = (i) => this.sort && this.sort.col === i ? (this.sort.dir > 0 ? ' ▲' : ' ▼') : '';
        this.thead.innerHTML = '';
        this.thead.append(el('tr', {}, [
            ...d.headers.map((h, i) => el('th', {
                class: 'sortable' + (d.types[i] === 'number' ? ' num' : ''), text: h + arrow(i),
                onclick: () => {
                    const s = this.sort;
                    this.sort = !s || s.col !== i ? { col: i, dir: 1 } : s.dir > 0 ? { col: i, dir: -1 } : null;
                    this.apply();
                }
            })),
            editable ? el('th') : null
        ]));

        this.tbody.innerHTML = '';
        const start = this.page * DA_PAGE_SIZE;
        const pageRows = this.filtered.slice(start, start + DA_PAGE_SIZE);
        if (!pageRows.length) {
            this.tbody.append(el('tr', {}, el('td', { colspan: d.headers.length + 1, class: 'empty', text: tr('SHEET_ADMIN_NO_ROWS', {}, '沒有符合的資料') })));
        }
        pageRows.forEach(r => {
            this.tbody.append(el('tr', {}, [
                ...d.headers.map((_, i) => {
                    const v = r.values[i] ?? '';
                    return el('td', { class: 'clip' + (d.types[i] === 'number' ? ' num' : ''), title: v, text: v });
                }),
                editable ? el('td', { class: 'row-actions' }, [
                    el('button', { class: 'btn btn-soft btn-sm', text: tr('SHEET_ADMIN_EDIT', {}, '編輯'), onclick: () => this.openEditor(r) }),
                    el('button', { class: 'btn btn-danger btn-sm', text: tr('SHEET_ADMIN_DELETE', {}, '刪除'), onclick: (e) => this.remove(r, e.currentTarget) })
                ]) : null
            ]));
        });

        this.pager.style.display = pages > 1 ? 'flex' : 'none';
        this.pageLabel.textContent = tr('SHEET_ADMIN_PAGE', { page: this.page + 1, pages }, '第 {page} / {pages} 頁');
        this.prev.disabled = this.page === 0;
        this.next.disabled = this.page >= pages - 1;
    }

    openEditor(row) {
        const d = this.data;
        if (!d || d.readonly) return;
        const name = d.name;
        const original = row ? row.values.slice() : null;
        const inputs = d.headers.map((h, i) => {
            const v = original ? (original[i] ?? '') : '';
            const long = String(v).length > 60 || String(v).includes('\n');
            const input = long ? el('textarea', { rows: 3 }) : el('input', { type: 'text', inputmode: d.types[i] === 'number' ? 'decimal' : null });
            input.value = v;
            return input;
        });
        const fields = inputs.map((input, i) => field(d.headers[i], input, {
            full: input.tagName === 'TEXTAREA',
            hint: d.types[i] === 'date' ? tr('SHEET_ADMIN_DATE_HINT', {}, '日期格式：yyyy-MM-dd 或 yyyy-MM-dd HH:mm:ss')
                : d.types[i] === 'number' ? tr('SHEET_ADMIN_NUMBER_HINT', {}, '數字') : ''
        }));
        const title = row
            ? tr('SHEET_ADMIN_EDIT_TITLE', { sheet: name, row: row.row }, '編輯「{sheet}」第 {row} 列')
            : tr('SHEET_ADMIN_ADD_TITLE', { sheet: name }, '新增到「{sheet}」');

        openModal(title, fields, async () => {
            const values = inputs.map(x => x.value);
            if (row && values.every((v, i) => v === (original[i] ?? ''))) return true;
            const params = { sheet: name, values: JSON.stringify(values) };
            if (row) {
                params.row = row.row;
                params.original = JSON.stringify(original);
            }
            const res = await daApi.post('sheetAdminSave', params);
            return handleWriteResult(res, () => this.load(name, true));
        });
    }

    async remove(row, button) {
        const d = this.data;
        const preview = d.headers.slice(0, 4).map((h, i) => `${h}: ${row.values[i] ?? ''}`).join('\n');
        if (!confirm(tr('SHEET_ADMIN_DELETE_CONFIRM', { sheet: d.name, row: row.row }, '確定要刪除「{sheet}」第 {row} 列嗎？刪除後無法復原。') + '\n\n' + preview)) return;
        busy(button, true);
        try {
            const res = await daApi.post('sheetAdminDelete', { sheet: d.name, row: row.row, original: JSON.stringify(row.values) });
            handleWriteResult(res, () => this.load(d.name, true));
        } catch (err) {
            console.error(err);
            toast(tr('NOTIF_SUBMIT_FAILED', {}, '送出失敗，請稍後再試'), 'error');
        } finally {
            if (button.isConnected) busy(button, false);
        }
    }
}

// ==================== 分頁切換與初始化 ====================

const tables = {};

function activateTab(name) {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.panel === name));
    try { sessionStorage.setItem('dataAdminTab', name); } catch {}

    if (name === 'attendance') return;
    if (!tables[name]) {
        const root = document.querySelector(`.tab-panel[data-panel="${name}"]`);
        tables[name] = new SheetTable(root, name === 'all' ? { picker: true } : { candidates: DA_TAB_SHEETS[name] });
    }
    tables[name].init();
}

function showBlocked(message) {
    const box = document.getElementById('da-blocked');
    box.textContent = message;
    box.style.display = 'block';
    document.getElementById('da-app').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations(detectLang());

    if (!localStorage.getItem('sessionToken')) {
        showBlocked(tr('DATA_ADMIN_LOGIN_FIRST', {}, '請先回到首頁登入。'));
        return;
    }
    try {
        const res = await daApi.get('checkSession');
        if (!res.ok || !res.user) {
            showBlocked(tr('DATA_ADMIN_LOGIN_FIRST', {}, '請先回到首頁登入。'));
            return;
        }
        if (res.user.dept !== '管理員') {
            showBlocked(tr('DATA_ADMIN_ADMIN_ONLY', {}, '此頁面僅限管理員使用。'));
            return;
        }
    } catch (err) {
        showBlocked(tr('NOTIF_SUBMIT_FAILED', {}, '連線失敗，請稍後再試'));
        return;
    }

    document.getElementById('da-app').style.display = 'block';
    document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => activateTab(b.dataset.tab)));
    initAttendanceTab();

    let saved = null;
    try { saved = sessionStorage.getItem('dataAdminTab'); } catch {}
    if (saved && document.querySelector(`.tab[data-tab="${saved}"]`)) activateTab(saved);
});
