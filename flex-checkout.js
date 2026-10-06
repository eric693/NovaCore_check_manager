// 當日工作地點提示 + 彈性下班原因（員工填寫、管理員審核）
// 依賴 utils.js / i18n.js / script.js 的 callApifetch()、showNotification()。

// 後端存的是中文狀態，顯示時轉成翻譯 key
const FLEX_STATUS_KEYS = {
    '待審核': 'FLEX_STATUS_PENDING',
    '已核准': 'FLEX_STATUS_APPROVED',
    '已拒絕': 'FLEX_STATUS_REJECTED'
};

let _flexPendingPromise = null;
let _flexAdminPromise = null;
let _flexSubmitting = false;

/**
 * 下班打卡成功後的後續：提示今天記錄的工作地點；工時未滿就請員工填原因
 * @param {Object} checkout 後端回傳的 { workDate, workLocation, workedHours, flexRequired, minHours }
 */
function handleCheckoutSummary(checkout) {
    if (!checkout) return;

    if (checkout.workLocation) {
        showNotification(t('WORK_LOCATION_RECORDED', { location: checkout.workLocation }), 'info');
    }

    if (checkout.flexRequired) {
        openFlexCheckoutDialog({
            date: checkout.workDate,
            workedHours: checkout.workedHours,
            workLocation: checkout.workLocation
        }, checkout.minHours);
    }
}

// ==================== 員工端 ====================

/**
 * 首頁「彈性下班原因待填寫」卡片
 */
function loadFlexCheckoutPending() {
    if (!document.getElementById('flex-checkout-section')) return Promise.resolve();
    if (_flexPendingPromise) return _flexPendingPromise;
    _flexPendingPromise = _doLoadFlexCheckoutPending().finally(() => { _flexPendingPromise = null; });
    return _flexPendingPromise;
}

async function _doLoadFlexCheckoutPending() {
    try {
        renderFlexCheckoutPending(await callApifetch('getMyFlexCheckout', 'flex-none'));
    } catch (err) {
        console.error('載入彈性下班原因失敗:', err);
    }
}

/**
 * 畫出首頁的待填寫卡片；initApp 登入時會直接帶這份資料過來
 * @param {Object} res getMyFlexCheckout 的回應 { ok, pending, records, minHours }
 */
function renderFlexCheckoutPending(res) {
    const section = document.getElementById('flex-checkout-section');
    const list = document.getElementById('flex-checkout-list');
    const desc = document.getElementById('flex-checkout-desc');
    if (!section) return;

    if (!res || !res.ok || !res.pending || res.pending.length === 0) {
        section.style.display = 'none';
        return;
    }

    // 同一天被退回過的話，把管理員意見一起顯示，員工才知道要怎麼改
    const rejected = {};
    (res.records || []).forEach(r => {
        if (r.status === '已拒絕' && !rejected[r.date]) rejected[r.date] = r;
    });

    desc.textContent = t('FLEX_SECTION_DESC', { min: res.minHours }) + ' ' + t('FLEX_DEDUCTION_NOTE', { min: res.minHours });
    list.innerHTML = '';
    res.pending.forEach(day => {
        const li = document.createElement('li');
        li.className = 'p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg flex items-center justify-between gap-3';
        const prev = rejected[day.date];
        li.innerHTML = `
            <div class="min-w-0">
                <p class="font-semibold text-gray-800 dark:text-white">${escapeHtml(day.date)}</p>
                <p class="text-sm text-gray-600 dark:text-gray-300">
                    ${escapeHtml(day.punchIn)} – ${escapeHtml(day.punchOut)}
                    ・${escapeHtml(t('FLEX_HOURS_VALUE', { hours: day.workedHours }))}
                </p>
                ${day.workLocation ? `<p class="text-sm text-gray-500 dark:text-gray-400 truncate">📍 ${escapeHtml(day.workLocation)}</p>` : ''}
                ${prev ? `<p class="text-xs text-red-600 dark:text-red-400 mt-1">${escapeHtml(t('FLEX_PREV_REJECTED', { comment: prev.comment || '-' }))}</p>` : ''}
            </div>
            <button class="flex-fill-btn shrink-0 px-4 py-2 rounded-md text-sm font-bold btn-primary">${escapeHtml(t('FLEX_FILL_BTN'))}</button>
        `;
        li.querySelector('.flex-fill-btn').addEventListener('click', () => openFlexCheckoutDialog(day, res.minHours));
        list.appendChild(li);
    });
    section.style.display = 'block';
}

/**
 * 填寫彈性下班原因的對話框
 */
function openFlexCheckoutDialog(day, minHours) {
    document.getElementById('flex-checkout-dialog')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'flex-checkout-dialog';
    overlay.className = 'fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4';
    overlay.innerHTML = `
        <div class="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
            <h3 class="text-lg font-bold text-gray-800 dark:text-white mb-2">${escapeHtml(t('FLEX_DIALOG_TITLE'))}</h3>
            <p class="text-sm text-gray-600 dark:text-gray-300 mb-1">
                ${escapeHtml(t('FLEX_DIALOG_DESC', { date: day.date, hours: day.workedHours, min: minHours || 9 }))}
            </p>
            <p class="text-xs text-amber-700 dark:text-amber-400 mb-1">
                ${escapeHtml(t('FLEX_DEDUCTION_NOTE', { min: minHours || 9 }))}
            </p>
            ${day.workLocation ? `<p class="text-sm text-gray-500 dark:text-gray-400 mb-3">📍 ${escapeHtml(day.workLocation)}</p>` : '<div class="mb-3"></div>'}
            <label for="flex-reason-input" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">${escapeHtml(t('FLEX_REASON_LABEL'))}</label>
            <textarea id="flex-reason-input" rows="4" maxlength="500"
                class="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm dark:bg-gray-700 dark:text-white focus:ring-indigo-500 focus:border-indigo-500"
                placeholder="${escapeHtml(t('FLEX_REASON_PLACEHOLDER'))}"></textarea>
            <div class="flex gap-2 mt-4">
                <button id="flex-later-btn" class="flex-1 py-2 rounded-md font-bold btn-secondary">${escapeHtml(t('FLEX_LATER_BTN'))}</button>
                <button id="flex-submit-btn" class="flex-1 py-2 rounded-md font-bold btn-primary">${escapeHtml(t('FLEX_SUBMIT_BTN'))}</button>
            </div>
        </div>
    `;
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#flex-later-btn').addEventListener('click', () => {
        close();
        loadFlexCheckoutPending(); // 稍後填寫的話首頁卡片會留著提醒
    });
    overlay.querySelector('#flex-submit-btn').addEventListener('click', async (e) => {
        const reason = overlay.querySelector('#flex-reason-input').value.trim();
        if (reason.length < 2) {
            showNotification(t('ERR_FLEX_REASON_REQUIRED'), 'error');
            return;
        }
        if (_flexSubmitting) return;
        _flexSubmitting = true;
        const btn = e.currentTarget;
        generalButtonState(btn, 'processing', t('LOADING'));
        try {
            const params = new URLSearchParams({ date: day.date, reason });
            const res = await callApifetch(`submitFlexCheckout&${params.toString()}`, 'flex-none');
            showNotification(t(res.code || 'UNKNOWN_ERROR'), res.ok ? 'success' : 'error');
            if (res.ok || res.code === 'ERR_FLEX_NOT_REQUIRED') {
                close();
                clearMonthDataCache();
                loadFlexCheckoutPending();
            }
        } catch (err) {
            console.error('送出彈性下班原因失敗:', err);
            showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
        } finally {
            _flexSubmitting = false;
            generalButtonState(btn, 'idle');
        }
    });
    setTimeout(() => overlay.querySelector('#flex-reason-input')?.focus(), 50);
}

// ==================== 管理員端 ====================

function loadPendingFlexCheckout() {
    if (!document.getElementById('pending-flex-list')) return Promise.resolve();
    if (_flexAdminPromise) return _flexAdminPromise;
    _flexAdminPromise = _doLoadPendingFlexCheckout().finally(() => { _flexAdminPromise = null; });
    return _flexAdminPromise;
}

async function _doLoadPendingFlexCheckout() {
    const list = document.getElementById('pending-flex-list');
    const empty = document.getElementById('flex-requests-empty');
    const loading = document.getElementById('flex-requests-loading');

    list.innerHTML = '';
    loading.style.display = 'block';
    empty.style.display = 'none';

    try {
        const res = await callApifetch('getPendingFlexCheckout', 'flex-none');
        loading.style.display = 'none';
        if (!res.ok || !res.requests || res.requests.length === 0) {
            empty.style.display = 'block';
            return;
        }

        res.requests.forEach(req => {
            const li = document.createElement('li');
            li.className = 'p-4 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-2';
            li.innerHTML = `
                <div>
                    <p class="font-semibold text-gray-800 dark:text-white">${escapeHtml(req.name)}</p>
                    <p class="text-sm text-gray-600 dark:text-gray-400">
                        ${escapeHtml(req.date)} | ${escapeHtml(req.punchIn)} – ${escapeHtml(req.punchOut)}
                        ・${escapeHtml(t('FLEX_HOURS_VALUE', { hours: req.workedHours }))}
                    </p>
                    ${req.workLocation ? `<p class="text-sm text-gray-500 dark:text-gray-400">📍 ${escapeHtml(req.workLocation)}</p>` : ''}
                </div>
                <p class="text-sm text-gray-700 dark:text-gray-300">
                    <strong>${escapeHtml(t('FLEX_REASON_LABEL'))}：</strong>${escapeHtml(req.reason)}
                </p>
                <div class="flex space-x-2 pt-1">
                    <button data-action="approve" class="flex-1 px-3 py-2 rounded-md text-sm font-bold btn-primary">${escapeHtml(t('ADMIN_APPROVE_BUTTON'))}</button>
                    <button data-action="reject" class="flex-1 px-3 py-2 rounded-md text-sm font-bold btn-warning">${escapeHtml(t('ADMIN_REJECT_BUTTON'))}</button>
                </div>
            `;
            li.querySelectorAll('button[data-action]').forEach(btn => {
                btn.addEventListener('click', () => reviewFlexCheckout(req.id, btn.dataset.action, li));
            });
            list.appendChild(li);
        });
    } catch (err) {
        loading.style.display = 'none';
        console.error('載入待審核彈性下班失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
    }
}

async function reviewFlexCheckout(id, action, li) {
    let comment = '';
    if (action === 'reject') {
        // 退回時請管理員說明，員工會收到這段文字並重新填寫
        const input = prompt(t('FLEX_REJECT_PROMPT'), '');
        if (input === null) return;
        comment = input.trim();
    }

    const buttons = li.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; b.classList.add('opacity-50', 'cursor-not-allowed'); });

    try {
        const params = new URLSearchParams({ id, reviewAction: action, comment });
        const res = await callApifetch(`reviewFlexCheckout&${params.toString()}`, 'flex-none');
        showNotification(t(res.code || 'UNKNOWN_ERROR'), res.ok ? 'success' : 'error');
        if (res.ok || res.code === 'ERR_ALREADY_REVIEWED') {
            li.remove();
            const list = document.getElementById('pending-flex-list');
            if (list && !list.children.length) {
                document.getElementById('flex-requests-empty').style.display = 'block';
            }
            return;
        }
    } catch (err) {
        console.error('審核彈性下班失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
    }
    buttons.forEach(b => { b.disabled = false; b.classList.remove('opacity-50', 'cursor-not-allowed'); });
}
