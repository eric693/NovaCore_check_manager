// 停班日（颱風假等）與出差：首頁提醒、員工出差申請、管理員設定停班日與審核出差
// 後端：GS/WorkCalendar.gs。依賴 utils.js / i18n.js / script.js 的 callApifetch()、showNotification()。

const TRIP_STATUS_KEYS = {
    '待審核': 'TRIP_STATUS_PENDING',
    '已核准': 'TRIP_STATUS_APPROVED',
    '已拒絕': 'TRIP_STATUS_REJECTED',
    '已取消': 'TRIP_STATUS_CANCELLED'
};
const TRIP_STATUS_COLORS = {
    '待審核': 'text-amber-600 dark:text-amber-400',
    '已核准': 'text-green-600 dark:text-green-400',
    '已拒絕': 'text-red-600 dark:text-red-400',
    '已取消': 'text-gray-500 dark:text-gray-400'
};

function closureScopeLabel(scope) {
    return t(scope === '下午' ? 'CLOSURE_SCOPE_AFTERNOON' : 'CLOSURE_SCOPE_FULL');
}

function tripStatusLabel(status) {
    return t(TRIP_STATUS_KEYS[status] || status);
}

// ==================== 首頁：停班提醒 ====================

/**
 * @param {Array<{date: string, scope: string}>} closures initApp 帶回的 7 天內停班日
 */
function renderClosureBanner(closures) {
    const banner = document.getElementById('closure-banner');
    const list = document.getElementById('closure-banner-list');
    if (!banner || !list) return;
    if (!closures || !closures.length) {
        banner.style.display = 'none';
        return;
    }
    const today = todayStr();
    list.innerHTML = '';
    closures.forEach(c => {
        const li = document.createElement('li');
        li.textContent = t(c.date === today ? 'CLOSURE_BANNER_TODAY' : 'CLOSURE_BANNER', {
            date: c.date,
            scope: closureScopeLabel(c.scope)
        });
        list.appendChild(li);
    });
    banner.style.display = 'block';
}

// ==================== 員工：出差申請 ====================

let _tripSubmitting = false;

async function loadMyTrips() {
    const list = document.getElementById('trip-my-list');
    if (!list) return;
    try {
        const res = await callApifetch('getMyTrips', 'trip-none');
        renderMyTrips(res.ok ? (res.trips || []) : []);
    } catch (err) {
        console.error('載入出差紀錄失敗:', err);
    }
}

function renderMyTrips(trips) {
    const list = document.getElementById('trip-my-list');
    const empty = document.getElementById('trip-my-empty');
    list.innerHTML = '';
    empty.style.display = trips.length ? 'none' : 'block';
    trips.forEach(trip => {
        const li = document.createElement('li');
        li.className = 'p-4 bg-gray-50 dark:bg-gray-700 rounded-lg';
        li.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-semibold text-gray-800 dark:text-white">${escapeHtml(trip.start)} ～ ${escapeHtml(trip.end)}</p>
                    <p class="text-sm text-gray-600 dark:text-gray-300">📍 ${escapeHtml(trip.location)}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400 break-words">${escapeHtml(trip.reason)}</p>
                    ${trip.comment ? `<p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${escapeHtml(t('FLEX_REVIEW_COMMENT'))}：${escapeHtml(trip.comment)}</p>` : ''}
                </div>
                <div class="text-right shrink-0">
                    <p class="text-sm font-semibold ${TRIP_STATUS_COLORS[trip.status] || ''}">${escapeHtml(tripStatusLabel(trip.status))}</p>
                    ${trip.status === '待審核' ? `<button data-act="cancel" class="mt-2 px-3 py-1 rounded-md text-xs font-bold btn-secondary">${escapeHtml(t('TRIP_CANCEL'))}</button>` : ''}
                </div>
            </div>
        `;
        li.querySelector('[data-act="cancel"]')?.addEventListener('click', async (e) => {
            if (!confirm(t('TRIP_CANCEL_CONFIRM'))) return;
            const btn = e.currentTarget;
            generalButtonState(btn, 'processing', '…');
            try {
                const res = await callApifetch(`cancelTrip&id=${encodeURIComponent(trip.id)}`, 'trip-none');
                showNotification(t(res.code || 'UNKNOWN_ERROR'), res.ok ? 'success' : 'error');
                loadMyTrips();
            } catch (err) {
                showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
                if (btn.isConnected) generalButtonState(btn, 'idle');
            }
        });
        list.appendChild(li);
    });
}

async function submitTrip() {
    if (_tripSubmitting) return;
    const start = document.getElementById('trip-start').value;
    const end = document.getElementById('trip-end').value;
    const location = document.getElementById('trip-location').value.trim();
    const reason = document.getElementById('trip-reason').value.trim();

    if (!start || !end || end < start) {
        showNotification(t('ERR_TRIP_BAD_DATES'), 'warning');
        return;
    }
    if (!location) {
        showNotification(t('ERR_TRIP_LOCATION_REQUIRED'), 'warning');
        return;
    }
    if (reason.length < 2) {
        showNotification(t('ERR_TRIP_REASON_REQUIRED'), 'warning');
        return;
    }

    _tripSubmitting = true;
    const btn = document.getElementById('trip-submit-btn');
    generalButtonState(btn, 'processing', t('LOADING'));
    try {
        const params = new URLSearchParams({ start, end, location, reason });
        const res = await callApifetch(`submitTrip&${params.toString()}`, 'trip-none');
        showNotification(t(res.code || 'UNKNOWN_ERROR', res.params || {}), res.ok ? 'success' : 'error');
        if (res.ok) {
            ['trip-start', 'trip-end', 'trip-location', 'trip-reason'].forEach(id => { document.getElementById(id).value = ''; });
            loadMyTrips();
        }
    } catch (err) {
        console.error('送出出差申請失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
    } finally {
        _tripSubmitting = false;
        generalButtonState(btn, 'idle');
    }
}

// ==================== 管理員：停班日 ====================

async function loadClosureAdmin() {
    const list = document.getElementById('closure-list');
    if (!list) return;
    try {
        const res = await callApifetch('getClosures', 'closure-none');
        renderClosureAdmin(res.ok ? (res.closures || []) : []);
    } catch (err) {
        console.error('載入停班日失敗:', err);
    }
}

function renderClosureAdmin(closures) {
    const list = document.getElementById('closure-list');
    const empty = document.getElementById('closure-list-empty');
    list.innerHTML = '';
    empty.style.display = closures.length ? 'none' : 'block';
    // 新的在上面
    closures.slice().reverse().forEach(c => {
        const li = document.createElement('li');
        li.className = 'p-3 bg-gray-50 dark:bg-gray-700 rounded-lg flex items-center justify-between gap-3';
        li.innerHTML = `
            <div class="min-w-0">
                <p class="font-semibold text-gray-800 dark:text-white">${escapeHtml(c.date)}・${escapeHtml(closureScopeLabel(c.scope))}</p>
                <p class="text-sm text-gray-500 dark:text-gray-400 break-words">${escapeHtml(c.reason)}${c.createdBy ? `（${escapeHtml(c.createdBy)}）` : ''}</p>
            </div>
            <button class="shrink-0 px-3 py-1 rounded-md text-sm font-bold btn-warning">${escapeHtml(t('SHEET_ADMIN_DELETE'))}</button>
        `;
        li.querySelector('button').addEventListener('click', async (e) => {
            if (!confirm(t('CLOSURE_DELETE_CONFIRM', { date: c.date }))) return;
            const btn = e.currentTarget;
            generalButtonState(btn, 'processing', '…');
            try {
                const res = await callApifetch(`deleteClosure&id=${encodeURIComponent(c.id)}`, 'closure-none');
                showNotification(t(res.code || 'UNKNOWN_ERROR'), res.ok ? 'success' : 'error');
                if (typeof clearMonthDataCache === 'function') clearMonthDataCache();
                loadClosureAdmin();
            } catch (err) {
                showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
                if (btn.isConnected) generalButtonState(btn, 'idle');
            }
        });
        list.appendChild(li);
    });
}

async function addClosure() {
    const date = document.getElementById('closure-date').value;
    const scope = document.getElementById('closure-scope').value;
    const reason = document.getElementById('closure-reason').value.trim();
    const notify = document.getElementById('closure-notify').checked;
    if (!date) {
        showNotification(t('CLOSURE_DATE_REQUIRED'), 'warning');
        return;
    }
    if (!confirm(t('CLOSURE_ADD_CONFIRM', { date, scope: closureScopeLabel(scope) }))) return;

    const btn = document.getElementById('closure-add-btn');
    generalButtonState(btn, 'processing', t('LOADING'));
    try {
        const params = new URLSearchParams({ date, scope, reason, notify: notify ? '1' : '0' });
        const res = await callApifetch(`addClosure&${params.toString()}`, 'closure-none');
        const msg = res.ok && notify
            ? t('CLOSURE_ADDED_NOTIFIED', { n: res.notified || 0 })
            : t(res.code || 'UNKNOWN_ERROR');
        showNotification(msg, res.ok ? 'success' : 'error');
        if (res.ok) {
            document.getElementById('closure-reason').value = '';
            document.getElementById('closure-notify').checked = false;
            if (typeof clearMonthDataCache === 'function') clearMonthDataCache();
            loadClosureAdmin();
        }
    } catch (err) {
        console.error('新增停班日失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
    } finally {
        generalButtonState(btn, 'idle');
    }
}

// ==================== 管理員：出差審核 ====================

async function loadTripAdmin() {
    const list = document.getElementById('trip-pending-list');
    if (!list) return;
    try {
        const res = await callApifetch('getPendingTrips', 'trip-none');
        if (!res.ok) return;
        renderTripPending(res.requests || []);
        renderTripApproved(res.approved || []);
    } catch (err) {
        console.error('載入出差申請失敗:', err);
    }
}

function tripSummaryHtml(trip) {
    return `
        <p class="font-semibold text-gray-800 dark:text-white">${escapeHtml(trip.name)}</p>
        <p class="text-sm text-gray-600 dark:text-gray-300">${escapeHtml(trip.start)} ～ ${escapeHtml(trip.end)}・📍 ${escapeHtml(trip.location)}</p>
        <p class="text-sm text-gray-500 dark:text-gray-400 break-words">${escapeHtml(trip.reason)}</p>
    `;
}

function renderTripPending(trips) {
    const list = document.getElementById('trip-pending-list');
    document.getElementById('trip-pending-empty').style.display = trips.length ? 'none' : 'block';
    list.innerHTML = '';
    trips.forEach(trip => {
        const li = document.createElement('li');
        li.className = 'p-4 bg-gray-50 dark:bg-gray-700 rounded-lg space-y-2';
        li.innerHTML = `
            <div>${tripSummaryHtml(trip)}</div>
            <div class="flex space-x-2 pt-1">
                <button data-action="approve" class="flex-1 px-3 py-2 rounded-md text-sm font-bold btn-primary">${escapeHtml(t('ADMIN_APPROVE_BUTTON'))}</button>
                <button data-action="reject" class="flex-1 px-3 py-2 rounded-md text-sm font-bold btn-warning">${escapeHtml(t('ADMIN_REJECT_BUTTON'))}</button>
            </div>
        `;
        li.querySelectorAll('button[data-action]').forEach(b => b.addEventListener('click', () => reviewTrip(trip, b.dataset.action, li)));
        list.appendChild(li);
    });
}

function renderTripApproved(trips) {
    const list = document.getElementById('trip-approved-list');
    document.getElementById('trip-approved-empty').style.display = trips.length ? 'none' : 'block';
    list.innerHTML = '';
    trips.forEach(trip => {
        const li = document.createElement('li');
        li.className = 'p-3 bg-gray-50 dark:bg-gray-700 rounded-lg flex items-start justify-between gap-3';
        li.innerHTML = `
            <div class="min-w-0">${tripSummaryHtml(trip)}</div>
            <button data-action="revoke" class="shrink-0 px-3 py-1 rounded-md text-sm font-bold btn-secondary">${escapeHtml(t('TRIP_REVOKE'))}</button>
        `;
        li.querySelector('button').addEventListener('click', () => reviewTrip(trip, 'revoke', li));
        list.appendChild(li);
    });
}

async function reviewTrip(trip, action, li) {
    let comment = '';
    if (action === 'reject' || action === 'revoke') {
        const input = prompt(t(action === 'reject' ? 'TRIP_REJECT_PROMPT' : 'TRIP_REVOKE_PROMPT'), '');
        if (input === null) return;
        comment = input.trim();
    }
    const buttons = li.querySelectorAll('button');
    buttons.forEach(b => { b.disabled = true; b.classList.add('opacity-50', 'cursor-not-allowed'); });
    try {
        const params = new URLSearchParams({ id: trip.id, reviewAction: action, comment });
        const res = await callApifetch(`reviewTrip&${params.toString()}`, 'trip-none');
        showNotification(t(res.code || 'UNKNOWN_ERROR'), res.ok ? 'success' : 'error');
        if (res.ok || res.code === 'ERR_ALREADY_REVIEWED') {
            if (typeof clearMonthDataCache === 'function') clearMonthDataCache();
            loadTripAdmin();
            return;
        }
    } catch (err) {
        console.error('審核出差失敗:', err);
        showNotification(t('NOTIF_SUBMIT_FAILED'), 'error');
        loadTripAdmin();
        return;
    }
    buttons.forEach(b => { b.disabled = false; b.classList.remove('opacity-50', 'cursor-not-allowed'); });
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('trip-submit-btn')?.addEventListener('click', submitTrip);
    document.getElementById('closure-add-btn')?.addEventListener('click', addClosure);
    const closureDate = document.getElementById('closure-date');
    if (closureDate && !closureDate.value) closureDate.value = todayStr();
});
