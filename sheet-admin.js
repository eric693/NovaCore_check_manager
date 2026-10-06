// 管理員：資料表管理（檢視／搜尋／篩選／排序／新增／編輯／刪除試算表資料）
// 後端：GS/SheetAdmin.gs。整張表一次載入，搜尋、篩選、排序、分頁都在前端做，切換條件不用等後端。
// 依賴 utils.js / i18n.js / script.js 的 callApifetch()、showNotification()。

const SHEET_ADMIN_PAGE_SIZE = 50;

const sheetAdmin = {
    inited: false,
    data: null,        // { name, headers, types, rows: [{row, values}], readonly }
    filtered: [],
    search: '',
    filters: [],       // [{ col, op, value }]
    sort: null,        // { col, dir: 1 | -1 }
    page: 0,
    loadSeq: 0         // 快速切換工作表時，只採用最後一次請求的結果
};

/**
 * 寫入類的請求一律用 POST：整列資料放網址可能超過長度限制，也不該留在存取紀錄裡。
 * Main.gs 的 doPost 會把表單請求轉給 doGet 的路由。
 */
async function sheetAdminPost(action, params) {
    const body = new URLSearchParams({ ...params, action, token: localStorage.getItem('sessionToken') || '' });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
        const res = await fetch(API_CONFIG.apiUrl, { method: 'POST', body, signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

function initSheetAdmin() {
    if (!document.getElementById('sheet-admin-card')) return;
    if (!sheetAdmin.inited) {
        sheetAdmin.inited = true;
        bindSheetAdminEvents();
    }
    loadSheetAdminList();
}

function bindSheetAdminEvents() {
    const $ = (id) => document.getElementById(id);

    $('sheet-admin-select').addEventListener('change', (e) => loadSheetAdminData(e.target.value));
    $('sheet-admin-refresh').addEventListener('click', () => {
        const name = $('sheet-admin-select').value;
        if (name) loadSheetAdminData(name, { keepView: true });
        else loadSheetAdminList();
    });
    $('sheet-admin-add').addEventListener('click', () => openSheetAdminEditor(null));

    let searchTimer = null;
    $('sheet-admin-search').addEventListener('input', (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
            sheetAdmin.search = e.target.value.trim().toLowerCase();
            sheetAdmin.page = 0;
            applySheetAdminView();
        }, 200);
    });

    const addFilter = () => {
        const col = parseInt($('sheet-admin-filter-col').value, 10);
        const op = $('sheet-admin-filter-op').value;
        const value = $('sheet-admin-filter-val').value.trim();
        if (isNaN(col)) return;
        if (!['empty', 'notempty'].includes(op) && value === '') {
            showNotification(t('SHEET_ADMIN_FILTER_NEED_VALUE'), 'warning');
            return;
        }
        sheetAdmin.filters.push({ col, op, value });
        $('sheet-admin-filter-val').value = '';
        sheetAdmin.page = 0;
        applySheetAdminView();
    };
    $('sheet-admin-filter-add').addEventListener('click', addFilter);
    $('sheet-admin-filter-val').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFilter(); });

    $('sheet-admin-prev').addEventListener('click', () => { sheetAdmin.page--; renderSheetAdminTable(); });
    $('sheet-admin-next').addEventListener('click', () => { sheetAdmin.page++; renderSheetAdminTable(); });
}

function sheetAdminStatus(text) {
    const el = document.getElementById('sheet-admin-status');
    el.textContent = text || '';
    el.style.display = text ? 'block' : 'none';
}

async function loadSheetAdminList() {
    const select = document.getElementById('sheet-admin-select');
    try {
        const res = await callApifetch('sheetAdminList', 'sheet-admin-none');
        if (!res.ok) {
            showNotification(t(res.code || 'UNKNOWN_ERROR'), 'error');
            return;
        }
        const current = select.value;
        select.innerHTML = '';
        select.appendChild(new Option(t('SHEET_ADMIN_PICK'), ''));
        (res.sheets || []).forEach(sh => {
            const label = `${sh.name}（${sh.rows}）${sh.readonly ? ' 🔒' : ''}`;
            select.appendChild(new Option(label, sh.name));
        });
        if (current && (res.sheets || []).some(sh => sh.name === current)) select.value = current;
    } catch (err) {
        console.error('載入工作表清單失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
    }
}

/**
 * 載入一張表
 * @param {Object} [opts] keepView: 重新整理時保留搜尋、篩選、排序與頁數
 */
async function loadSheetAdminData(name, opts = {}) {
    const seq = ++sheetAdmin.loadSeq;
    const wrap = document.getElementById('sheet-admin-table-wrap');
    const tools = document.getElementById('sheet-admin-tools');
    const pager = document.getElementById('sheet-admin-pager');
    const addBtn = document.getElementById('sheet-admin-add');

    if (!opts.keepView) {
        sheetAdmin.search = '';
        sheetAdmin.filters = [];
        sheetAdmin.sort = null;
        sheetAdmin.page = 0;
        document.getElementById('sheet-admin-search').value = '';
    }

    if (!name) {
        sheetAdmin.data = null;
        wrap.style.display = tools.style.display = pager.style.display = 'none';
        addBtn.disabled = true;
        sheetAdminStatus('');
        return;
    }

    sheetAdminStatus(t('LOADING'));
    try {
        const res = await callApifetch(`sheetAdminGet&sheet=${encodeURIComponent(name)}`, 'sheet-admin-none');
        if (seq !== sheetAdmin.loadSeq) return;
        if (!res.ok) {
            sheetAdminStatus('');
            showNotification(t(res.code || 'UNKNOWN_ERROR'), 'error');
            return;
        }
        sheetAdmin.data = res;
        addBtn.disabled = !!res.readonly || res.headers.length === 0;

        const colSelect = document.getElementById('sheet-admin-filter-col');
        colSelect.innerHTML = '';
        res.headers.forEach((h, i) => colSelect.appendChild(new Option(h, String(i))));

        tools.style.display = 'block';
        sheetAdminStatus('');
        applySheetAdminView();
    } catch (err) {
        if (seq !== sheetAdmin.loadSeq) return;
        console.error('載入工作表失敗:', err);
        sheetAdminStatus('');
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
    }
}

// 數字或日期（yyyy-MM-dd…）都能直接比大小；其他用字串比
function sheetAdminCompare(a, b) {
    const na = Number(String(a).replace(/,/g, ''));
    const nb = Number(String(b).replace(/,/g, ''));
    if (a !== '' && b !== '' && !isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b), 'zh-Hant', { numeric: true });
}

function sheetAdminMatch(cell, f) {
    const v = String(cell ?? '');
    const lv = v.toLowerCase();
    const fv = f.value.toLowerCase();
    switch (f.op) {
        case 'contains': return lv.includes(fv);
        case 'eq': return lv === fv;
        case 'neq': return lv !== fv;
        case 'gte': return v !== '' && sheetAdminCompare(v, f.value) >= 0;
        case 'lte': return v !== '' && sheetAdminCompare(v, f.value) <= 0;
        case 'empty': return v === '';
        case 'notempty': return v !== '';
        default: return true;
    }
}

function applySheetAdminView() {
    const d = sheetAdmin.data;
    if (!d) return;

    let rows = d.rows;
    if (sheetAdmin.search) {
        rows = rows.filter(r => r.values.some(v => String(v).toLowerCase().includes(sheetAdmin.search)));
    }
    sheetAdmin.filters.forEach(f => {
        rows = rows.filter(r => sheetAdminMatch(r.values[f.col], f));
    });
    if (sheetAdmin.sort) {
        const { col, dir } = sheetAdmin.sort;
        rows = rows.slice().sort((a, b) => dir * sheetAdminCompare(a.values[col] ?? '', b.values[col] ?? ''));
    }
    sheetAdmin.filtered = rows;

    renderSheetAdminChips();
    document.getElementById('sheet-admin-count').textContent =
        t('SHEET_ADMIN_COUNT', { total: d.rows.length, shown: rows.length });
    renderSheetAdminTable();
}

function renderSheetAdminChips() {
    const box = document.getElementById('sheet-admin-chips');
    box.innerHTML = '';
    const opLabel = {
        contains: t('SHEET_ADMIN_OP_CONTAINS'), eq: t('SHEET_ADMIN_OP_EQ'), neq: t('SHEET_ADMIN_OP_NEQ'),
        gte: '≥', lte: '≤', empty: t('SHEET_ADMIN_OP_EMPTY'), notempty: t('SHEET_ADMIN_OP_NOTEMPTY')
    };
    sheetAdmin.filters.forEach((f, i) => {
        const chip = document.createElement('span');
        chip.className = 'inline-flex items-center gap-1 px-2 py-1 rounded-full bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200 text-xs';
        chip.textContent = `${sheetAdmin.data.headers[f.col]} ${opLabel[f.op]} ${f.value}`.trim();
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'ml-1 font-bold';
        x.textContent = '×';
        x.setAttribute('aria-label', t('SHEET_ADMIN_REMOVE_FILTER'));
        x.addEventListener('click', () => {
            sheetAdmin.filters.splice(i, 1);
            sheetAdmin.page = 0;
            applySheetAdminView();
        });
        chip.appendChild(x);
        box.appendChild(chip);
    });
}

function renderSheetAdminTable() {
    const d = sheetAdmin.data;
    const thead = document.getElementById('sheet-admin-thead');
    const tbody = document.getElementById('sheet-admin-tbody');
    const wrap = document.getElementById('sheet-admin-table-wrap');
    const pager = document.getElementById('sheet-admin-pager');

    const pages = Math.max(1, Math.ceil(sheetAdmin.filtered.length / SHEET_ADMIN_PAGE_SIZE));
    sheetAdmin.page = Math.min(Math.max(sheetAdmin.page, 0), pages - 1);

    // 表頭：點欄名排序（升冪 → 降冪 → 不排序）
    const arrow = (i) => sheetAdmin.sort && sheetAdmin.sort.col === i ? (sheetAdmin.sort.dir > 0 ? ' ▲' : ' ▼') : '';
    thead.innerHTML = `<tr>
        ${d.readonly ? '' : `<th class="px-2 py-2 text-left font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap">${escapeHtml(t('SHEET_ADMIN_ACTIONS'))}</th>`}
        <th class="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">#</th>
        ${d.headers.map((h, i) => `
            <th data-col="${i}" class="px-2 py-2 text-left font-semibold text-gray-700 dark:text-gray-200 whitespace-nowrap cursor-pointer select-none hover:text-indigo-600">
                ${escapeHtml(h)}${arrow(i)}
            </th>`).join('')}
    </tr>`;
    thead.querySelectorAll('th[data-col]').forEach(th => th.addEventListener('click', () => {
        const col = parseInt(th.dataset.col, 10);
        const s = sheetAdmin.sort;
        sheetAdmin.sort = !s || s.col !== col ? { col, dir: 1 } : s.dir > 0 ? { col, dir: -1 } : null;
        applySheetAdminView();
    }));

    const start = sheetAdmin.page * SHEET_ADMIN_PAGE_SIZE;
    const pageRows = sheetAdmin.filtered.slice(start, start + SHEET_ADMIN_PAGE_SIZE);
    tbody.innerHTML = '';
    if (!pageRows.length) {
        tbody.innerHTML = `<tr><td colspan="${d.headers.length + 2}" class="px-2 py-6 text-center text-gray-500 dark:text-gray-400">${escapeHtml(t('SHEET_ADMIN_NO_ROWS'))}</td></tr>`;
    }
    pageRows.forEach(r => {
        const tr = document.createElement('tr');
        tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700/50';
        tr.innerHTML = `
            ${d.readonly ? '' : `
            <td class="px-2 py-1 whitespace-nowrap">
                <button data-act="edit" class="px-2 py-1 rounded text-xs font-bold btn-secondary">${escapeHtml(t('SHEET_ADMIN_EDIT'))}</button>
                <button data-act="delete" class="px-2 py-1 rounded text-xs font-bold btn-warning">${escapeHtml(t('SHEET_ADMIN_DELETE'))}</button>
            </td>`}
            <td class="px-2 py-1 text-gray-400">${r.row}</td>
            ${d.headers.map((_, i) => {
                const v = r.values[i] ?? '';
                return `<td class="px-2 py-1 text-gray-800 dark:text-gray-200 max-w-[16rem] truncate" title="${escapeHtml(v)}">${escapeHtml(v)}</td>`;
            }).join('')}
        `;
        tr.querySelector('[data-act="edit"]')?.addEventListener('click', () => openSheetAdminEditor(r));
        tr.querySelector('[data-act="delete"]')?.addEventListener('click', (e) => deleteSheetAdminRow(r, e.currentTarget));
        tbody.appendChild(tr);
    });

    wrap.style.display = 'block';
    pager.style.display = pages > 1 ? 'flex' : 'none';
    document.getElementById('sheet-admin-page').textContent = t('SHEET_ADMIN_PAGE', { page: sheetAdmin.page + 1, pages });
    document.getElementById('sheet-admin-prev').disabled = sheetAdmin.page === 0;
    document.getElementById('sheet-admin-next').disabled = sheetAdmin.page >= pages - 1;
}

/**
 * 新增（row 為 null）或編輯一列的表單
 */
function openSheetAdminEditor(row) {
    const d = sheetAdmin.data;
    if (!d || d.readonly) return;
    document.getElementById('sheet-admin-dialog')?.remove();

    const sheetName = d.name;
    const original = row ? row.values.slice() : null;
    const overlay = document.createElement('div');
    overlay.id = 'sheet-admin-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    overlay.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div class="p-5 border-b border-gray-200 dark:border-gray-700">
                <h3 class="text-lg font-bold text-gray-800 dark:text-white">
                    ${escapeHtml(row ? t('SHEET_ADMIN_EDIT_TITLE', { sheet: sheetName, row: row.row }) : t('SHEET_ADMIN_ADD_TITLE', { sheet: sheetName }))}
                </h3>
            </div>
            <form class="p-5 space-y-3 overflow-y-auto" novalidate>
                ${d.headers.map((h, i) => {
                    const v = original ? (original[i] ?? '') : '';
                    const id = `sheet-admin-field-${i}`;
                    const hint = d.types[i] === 'date' ? t('SHEET_ADMIN_DATE_HINT')
                        : d.types[i] === 'number' ? t('SHEET_ADMIN_NUMBER_HINT') : '';
                    const field = String(v).length > 60 || String(v).includes('\n')
                        ? `<textarea id="${id}" data-col="${i}" rows="3" class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white text-sm">${escapeHtml(v)}</textarea>`
                        : `<input id="${id}" data-col="${i}" type="text" value="${escapeHtml(v)}" ${d.types[i] === 'number' ? 'inputmode="decimal"' : ''} class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md dark:bg-gray-700 dark:text-white text-sm">`;
                    return `
                        <div>
                            <label for="${id}" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${escapeHtml(h)}</label>
                            ${field}
                            ${hint ? `<p class="text-xs text-gray-400 mt-1">${escapeHtml(hint)}</p>` : ''}
                        </div>`;
                }).join('')}
            </form>
            <div class="p-5 border-t border-gray-200 dark:border-gray-700 flex gap-2">
                <button type="button" data-act="cancel" class="flex-1 py-2 rounded-md font-bold btn-secondary">${escapeHtml(t('SHEET_ADMIN_CANCEL'))}</button>
                <button type="button" data-act="save" class="flex-1 py-2 rounded-md font-bold btn-primary">${escapeHtml(t('SHEET_ADMIN_SAVE'))}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-act="save"]').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const values = d.headers.map((_, i) => overlay.querySelector(`[data-col="${i}"]`).value);
        if (row && values.every((v, i) => v === (original[i] ?? ''))) {
            overlay.remove();
            return;
        }

        generalButtonState(btn, 'processing', t('LOADING'));
        try {
            const params = { sheet: sheetName, values: JSON.stringify(values) };
            if (row) {
                params.row = row.row;
                params.original = JSON.stringify(original);
            }
            const res = await sheetAdminPost('sheetAdminSave', params);
            showNotification(t(res.code || 'UNKNOWN_ERROR', res.params || {}), res.ok ? 'success' : 'error');
            if (res.ok) {
                overlay.remove();
                loadSheetAdminData(sheetName, { keepView: true });
            } else if (res.code === 'ERR_ROW_CHANGED') {
                overlay.remove();
                loadSheetAdminData(sheetName, { keepView: true });
            }
        } catch (err) {
            console.error('儲存失敗:', err);
            showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
        } finally {
            if (btn.isConnected) generalButtonState(btn, 'idle');
        }
    });
    setTimeout(() => overlay.querySelector('[data-col]')?.focus(), 50);
}

async function deleteSheetAdminRow(row, btn) {
    const d = sheetAdmin.data;
    // 確認視窗列出前幾欄，避免刪錯列
    const preview = d.headers.slice(0, 4).map((h, i) => `${h}: ${row.values[i] ?? ''}`).join('\n');
    if (!confirm(t('SHEET_ADMIN_DELETE_CONFIRM', { sheet: d.name, row: row.row }) + '\n\n' + preview)) return;

    generalButtonState(btn, 'processing', '…');
    try {
        const res = await sheetAdminPost('sheetAdminDelete', {
            sheet: d.name,
            row: row.row,
            original: JSON.stringify(row.values)
        });
        showNotification(t(res.code || 'UNKNOWN_ERROR'), res.ok ? 'success' : 'error');
        // 刪除成功後下面的列號都會往上移，衝突時也要拿最新資料，兩種情況都重新載入
        if (res.ok || res.code === 'ERR_ROW_CHANGED') loadSheetAdminData(d.name, { keepView: true });
    } catch (err) {
        console.error('刪除失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
    } finally {
        if (btn.isConnected) generalButtonState(btn, 'idle');
    }
}
