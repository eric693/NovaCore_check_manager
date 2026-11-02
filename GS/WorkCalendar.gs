// WorkCalendar.gs - 公司停班日（颱風假等）與出差
//
// 停班日：管理員設定日期（全天或下午），全公司適用，照常發薪不扣款。
//   - 不算缺卡、不要求彈性下班原因、不算早退
//   - 請假時數不計停班的時段（全天整天不計；下午停班只算到午休開始）
// 出差：員工申請起訖日期，管理員核准後，期間每天註記「出差」，照常發薪。
//   - 不用打卡、不算缺卡、不要求彈性下班原因、不算早退
//   - 出勤明細、報表、薪資備註會列出出差天數，跨月時依各月份實際天數分開計算

const SHEET_CLOSURES = '公司停班日';
const SHEET_TRIPS = '出差申請';

const CLOSURE_FULL = '全天';
const CLOSURE_AFTERNOON = '下午';

const TRIP_STATUS_PENDING = '待審核';
const TRIP_STATUS_APPROVED = '已核准';
const TRIP_STATUS_REJECTED = '已拒絕';
const TRIP_STATUS_CANCELLED = '已取消';

// 一次出差最多幾天（防止打錯年份變成一整年都在出差）
const TRIP_MAX_DAYS = 90;

const CLOSURE_HEADERS = ['ID', '日期', '範圍', '原因', '建立者', '建立時間'];
const TRIP_HEADERS = ['申請ID', '用戶ID', '姓名', '開始日期', '結束日期', '出差地點', '事由',
                      '狀態', '申請時間', '審核人', '審核時間', '審核意見'];
const TR = {
  ID: 0, USER_ID: 1, NAME: 2, START: 3, END: 4, LOCATION: 5, REASON: 6,
  STATUS: 7, APPLIED_AT: 8, REVIEWER: 9, REVIEWED_AT: 10, COMMENT: 11
};

// ==================== 共用 ====================

function wcSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#4285f4').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    // 日期存成文字，避免試算表自動轉成日期物件後時區跑掉
    if (name === SHEET_CLOSURES) sheet.getRange('B:B').setNumberFormat('@');
    if (name === SHEET_TRIPS) sheet.getRange('D:E').setNumberFormat('@');
  }
  return sheet;
}

function wcDateKey_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return String(v || '').trim().substring(0, 10);
}

function wcValidDate_(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00');
  return !isNaN(d.getTime()) && wcDateKey_(d) === s;
}

/** 起訖日期之間的每一天（含頭尾），yyyy-MM-dd */
function wcEachDate_(startKey, endKey) {
  const out = [];
  const d = new Date(startKey + 'T12:00:00');
  for (let i = 0; i < 400; i++) {
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (key > endKey) break;
    out.push(key);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function wcAdmin_(token) {
  return sheetAdminAuth_(token);
}

function wcUser_(token) {
  const s = checkSession_(token);
  if (!s.ok || !s.user) return { error: { ok: false, code: 'ERR_SESSION_INVALID' } };
  return { user: s.user };
}

// ==================== 停班日 ====================

/**
 * 停班日對照表 { 'yyyy-MM-dd': '全天' | '下午' }（同一天設了兩次以全天為準）
 * 同一次執行中會被呼叫很多次（每一天的檢查），讀一次就記住。
 */
let _closureMapMemo = null;
function getClosureMap_() {
  if (_closureMapMemo) return _closureMapMemo;
  const map = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLOSURES);
  if (sheet) {
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      const key = wcDateKey_(values[i][1]);
      if (!wcValidDate_(key)) continue;
      const scope = String(values[i][2]).trim() === CLOSURE_AFTERNOON ? CLOSURE_AFTERNOON : CLOSURE_FULL;
      if (map[key] !== CLOSURE_FULL) map[key] = scope;
    }
  }
  _closureMapMemo = map;
  return map;
}

function closureScopeOn_(dateKey) {
  return getClosureMap_()[dateKey] || null;
}

/** 列出停班日（員工也看得到，首頁會提醒；近 120 天與之後的） */
function handleGetClosures(params) {
  const auth = wcUser_(params.token);
  if (auth.error) return auth.error;
  const since = wcDateKey_(new Date(Date.now() - 120 * 864e5));
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CLOSURES);
  const list = [];
  if (sheet) {
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      const date = wcDateKey_(values[i][1]);
      if (!wcValidDate_(date) || date < since) continue;
      list.push({
        id: String(values[i][0]), date: date,
        scope: String(values[i][2]).trim() === CLOSURE_AFTERNOON ? CLOSURE_AFTERNOON : CLOSURE_FULL,
        reason: String(values[i][3] || ''), createdBy: String(values[i][4] || '')
      });
    }
  }
  list.sort((a, b) => a.date.localeCompare(b.date));
  return { ok: true, closures: list };
}

/**
 * 新增停班日（params: token, date, scope=全天|下午, reason, notify=1 時 LINE 通知全體員工）
 */
/** 今天起 n 天內的停班日 [{date, scope}] */
function upcomingClosures_(n) {
  const today = wcDateKey_(new Date());
  const until = wcDateKey_(new Date(Date.now() + n * 864e5));
  const map = getClosureMap_();
  return Object.keys(map).filter(d => d >= today && d <= until).sort()
    .map(d => ({ date: d, scope: map[d] }));
}

function handleAddClosure(params) {
  const auth = wcAdmin_(params.token);
  if (auth.error) return auth.error;
  const date = String(params.date || '').trim();
  const scope = params.scope === CLOSURE_AFTERNOON ? CLOSURE_AFTERNOON : CLOSURE_FULL;
  const reason = String(params.reason || '').trim().substring(0, 100) || '颱風停班';
  if (!wcValidDate_(date)) return { ok: false, code: 'ERR_INVALID_INPUT' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'ERR_BUSY' };
  try {
    const sheet = wcSheet_(SHEET_CLOSURES, CLOSURE_HEADERS);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (wcDateKey_(values[i][1]) === date) return { ok: false, code: 'ERR_CLOSURE_EXISTS' };
    }
    const id = 'CL' + Utilities.getUuid().substring(0, 8).toUpperCase();
    sheet.appendRow([id, date, scope, reason, auth.user.name, new Date()]);
    _closureMapMemo = null;
    sheetAdminAudit_(auth.user, SHEET_CLOSURES, sheet.getLastRow(), '新增停班日', null, [date, scope, reason]);
  } finally {
    lock.releaseLock();
  }

  let notified = 0;
  if (String(params.notify) === '1') notified = notifyAllEmployeesClosure_(date, scope, reason);
  return { ok: true, code: 'CLOSURE_ADDED', notified: notified };
}

function handleDeleteClosure(params) {
  const auth = wcAdmin_(params.token);
  if (auth.error) return auth.error;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'ERR_BUSY' };
  try {
    const sheet = wcSheet_(SHEET_CLOSURES, CLOSURE_HEADERS);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][0]) === String(params.id)) {
        sheet.deleteRow(i + 1);
        _closureMapMemo = null;
        sheetAdminAudit_(auth.user, SHEET_CLOSURES, i + 1, '刪除停班日',
          [wcDateKey_(values[i][1]), values[i][2], values[i][3]], null);
        return { ok: true, code: 'CLOSURE_DELETED' };
      }
    }
    return { ok: false, code: 'ERR_NOT_FOUND' };
  } finally {
    lock.releaseLock();
  }
}

/**
 * LINE 通知全體在職員工。LINE 官方帳號免費方案每月推播則數有限，所以由管理員勾選才發。
 * @return {number} 成功送出的人數
 */
function notifyAllEmployeesClosure_(date, scope, reason) {
  let sent = 0;
  try {
    const values = SpreadsheetApp.getActive().getSheetByName(SHEET_EMPLOYEES).getDataRange().getValues();
    const text = '📢 公司停班通知\n📅 ' + date + '（' + scope + '停班）\n💬 ' + reason +
                 '\n停班時段不需打卡，薪資照常發放。';
    for (let i = 1; i < values.length; i++) {
      const userId = String(values[i][0] || '').trim();
      const status = String(values[i][7] || '').trim();
      if (!userId || (status && status !== '啟用')) continue;
      const res = sendLineNotification_(userId, { type: 'text', text: text });
      if (res && res.ok) sent++;
    }
  } catch (err) {
    Logger.log('notifyAllEmployeesClosure_ 錯誤: ' + err);
  }
  return sent;
}

// ==================== 出差 ====================

function tripRowToObject_(row, rowNumber) {
  return {
    id: String(row[TR.ID]), rowNumber: rowNumber,
    userId: String(row[TR.USER_ID]), name: String(row[TR.NAME] || ''),
    start: wcDateKey_(row[TR.START]), end: wcDateKey_(row[TR.END]),
    location: String(row[TR.LOCATION] || ''), reason: String(row[TR.REASON] || ''),
    status: String(row[TR.STATUS] || ''),
    appliedAt: row[TR.APPLIED_AT] ? formatDateTime(new Date(row[TR.APPLIED_AT])) : '',
    reviewer: String(row[TR.REVIEWER] || ''),
    reviewedAt: row[TR.REVIEWED_AT] ? formatDateTime(new Date(row[TR.REVIEWED_AT])) : '',
    comment: String(row[TR.COMMENT] || '')
  };
}

function readTrips_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TRIPS);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < values.length; i++) {
    if (!values[i][TR.ID]) continue;
    out.push(tripRowToObject_(values[i], i + 1));
  }
  return out;
}

/**
 * 員工已核准的出差日 { 'yyyy-MM-dd': { id, location, reason } }
 * @param {string} userId
 */
const _tripMapMemo = {};
function getApprovedTripMap_(userId) {
  const uid = String(userId || '').trim();
  if (_tripMapMemo[uid]) return _tripMapMemo[uid];
  const map = {};
  readTrips_().forEach(t => {
    if (t.userId !== uid || t.status !== TRIP_STATUS_APPROVED) return;
    if (!wcValidDate_(t.start) || !wcValidDate_(t.end)) return;
    wcEachDate_(t.start, t.end).forEach(d => { map[d] = { id: t.id, location: t.location, reason: t.reason }; });
  });
  _tripMapMemo[uid] = map;
  return map;
}

/**
 * 這天是否不需要上班打卡／不檢查工時：停班（全天或下午）或已核准出差
 * @return {string|null} 'closure' | 'trip' | null
 */
function exemptReasonOn_(userId, dateKey) {
  if (getApprovedTripMap_(userId)[dateKey]) return 'trip';
  if (closureScopeOn_(dateKey)) return 'closure';
  return null;
}

/**
 * 某月的出差天數與區間（薪資備註、報表用；跨月的出差會依各月份實際天數拆開）
 */
function tripSummaryForMonth_(userId, yearMonth) {
  const days = Object.keys(getApprovedTripMap_(userId)).filter(d => d.substring(0, 7) === yearMonth).sort();
  return { days: days.length, dates: days };
}

/**
 * 薪資備註用：「，出差3天(11/03-11/05)」；這個月沒有出差就回傳空字串
 */
function tripNoteForMonth_(userId, yearMonth) {
  try {
    const t = tripSummaryForMonth_(userId, yearMonth);
    if (!t.days) return '';
    const md = d => d.substring(5).replace('-', '/');
    return `，出差${t.days}天(${md(t.dates[0])}-${md(t.dates[t.dates.length - 1])})`;
  } catch (err) {
    Logger.log('tripNoteForMonth_ 錯誤: ' + err);
    return '';
  }
}

function handleSubmitTrip(params) {
  const auth = wcUser_(params.token);
  if (auth.error) return auth.error;
  const start = String(params.start || '').trim();
  const end = String(params.end || '').trim();
  const location = String(params.location || '').trim().substring(0, 100);
  const reason = String(params.reason || '').trim().substring(0, 500);
  if (!wcValidDate_(start) || !wcValidDate_(end) || end < start) return { ok: false, code: 'ERR_TRIP_BAD_DATES' };
  if (wcEachDate_(start, end).length > TRIP_MAX_DAYS) return { ok: false, code: 'ERR_TRIP_TOO_LONG', params: { max: TRIP_MAX_DAYS } };
  if (!location) return { ok: false, code: 'ERR_TRIP_LOCATION_REQUIRED' };
  if (reason.length < 2) return { ok: false, code: 'ERR_TRIP_REASON_REQUIRED' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'ERR_BUSY' };
  try {
    // 同一個人不能有重疊的待審核／已核准出差
    const overlap = readTrips_().some(t => t.userId === auth.user.userId &&
      (t.status === TRIP_STATUS_PENDING || t.status === TRIP_STATUS_APPROVED) &&
      t.start <= end && start <= t.end);
    if (overlap) return { ok: false, code: 'ERR_TRIP_OVERLAP' };

    const sheet = wcSheet_(SHEET_TRIPS, TRIP_HEADERS);
    const id = 'TR' + Utilities.getUuid().substring(0, 8).toUpperCase();
    const row = [];
    row[TR.ID] = id; row[TR.USER_ID] = auth.user.userId; row[TR.NAME] = auth.user.name;
    row[TR.START] = start; row[TR.END] = end; row[TR.LOCATION] = location; row[TR.REASON] = reason;
    row[TR.STATUS] = TRIP_STATUS_PENDING; row[TR.APPLIED_AT] = new Date();
    row[TR.REVIEWER] = ''; row[TR.REVIEWED_AT] = ''; row[TR.COMMENT] = '';
    sheet.appendRow(row);

    try {
      notifyAllAdmins_({
        type: 'text',
        text: '✈️ 出差申請待審核\n👤 ' + auth.user.name + '\n📅 ' + start + ' ～ ' + end +
              '\n📍 ' + location + '\n💬 ' + reason
      });
    } catch (e) {
      Logger.log('通知管理員失敗（不影響申請）: ' + e);
    }
    return { ok: true, code: 'TRIP_SUBMITTED', id: id };
  } finally {
    lock.releaseLock();
  }
}

function handleGetMyTrips(params) {
  const auth = wcUser_(params.token);
  if (auth.error) return auth.error;
  const trips = readTrips_().filter(t => t.userId === auth.user.userId)
    .sort((a, b) => b.start.localeCompare(a.start)).slice(0, 30);
  return { ok: true, trips: trips };
}

/** 員工取消自己還在待審核的出差 */
function handleCancelTrip(params) {
  const auth = wcUser_(params.token);
  if (auth.error) return auth.error;
  return updateTripStatus_(params.id, (t) => {
    if (t.userId !== auth.user.userId) return { ok: false, code: 'ERR_NO_PERMISSION' };
    if (t.status !== TRIP_STATUS_PENDING) return { ok: false, code: 'ERR_ALREADY_REVIEWED' };
    return { status: TRIP_STATUS_CANCELLED, reviewer: auth.user.name, comment: '' };
  }, 'TRIP_CANCELLED');
}

function handleGetPendingTrips(params) {
  const auth = wcAdmin_(params.token);
  if (auth.error) return auth.error;
  // 已核准的也一起回傳（還沒結束或剛結束 30 天內），行程取消時管理員可以撤銷
  const since = wcDateKey_(new Date(Date.now() - 30 * 864e5));
  const trips = readTrips_();
  return {
    ok: true,
    requests: trips.filter(t => t.status === TRIP_STATUS_PENDING),
    approved: trips.filter(t => t.status === TRIP_STATUS_APPROVED && t.end >= since)
      .sort((a, b) => a.start.localeCompare(b.start))
  };
}

/**
 * 管理員審核（params: token, id, reviewAction=approve|reject|revoke, comment）
 * revoke：撤銷已核准的出差（行程取消時用），那幾天就恢復成一般出勤檢查
 */
function handleReviewTrip(params) {
  const auth = wcAdmin_(params.token);
  if (auth.error) return auth.error;
  const action = String(params.reviewAction || '').toLowerCase();
  const comment = String(params.comment || '').trim().substring(0, 500);
  if (['approve', 'reject', 'revoke'].indexOf(action) < 0) return { ok: false, code: 'ERR_INVALID_INPUT' };

  const result = updateTripStatus_(params.id, (t) => {
    if (action === 'revoke') {
      if (t.status !== TRIP_STATUS_APPROVED) return { ok: false, code: 'ERR_INVALID_INPUT' };
      return { status: TRIP_STATUS_CANCELLED, reviewer: auth.user.name, comment: comment || '管理員撤銷' };
    }
    if (t.status !== TRIP_STATUS_PENDING) return { ok: false, code: 'ERR_ALREADY_REVIEWED' };
    return { status: action === 'approve' ? TRIP_STATUS_APPROVED : TRIP_STATUS_REJECTED, reviewer: auth.user.name, comment: comment };
  }, 'TRIP_REVIEWED');

  if (result.ok && result.trip) {
    try {
      const t = result.trip;
      const verb = result.status === TRIP_STATUS_APPROVED ? '✅ 已核准' : result.status === TRIP_STATUS_REJECTED ? '❌ 未核准' : '↩️ 已撤銷';
      sendLineNotification_(t.userId, {
        type: 'text',
        text: verb + '：您 ' + t.start + ' ～ ' + t.end + '（' + t.location + '）的出差' + (comment ? '\n💬 ' + comment : '')
      });
    } catch (e) {
      Logger.log('通知員工失敗（不影響審核）: ' + e);
    }
  }
  delete result.trip;
  return result;
}

/**
 * 改出差狀態的共用流程（有鎖；decide 回傳 {ok:false,...} 表示拒絕）
 */
function updateTripStatus_(id, decide, successCode) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'ERR_BUSY' };
  try {
    const sheet = wcSheet_(SHEET_TRIPS, TRIP_HEADERS);
    const values = sheet.getDataRange().getValues();
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][TR.ID]) !== String(id)) continue;
      const trip = tripRowToObject_(values[i], i + 1);
      const d = decide(trip);
      if (d.ok === false) return d;
      sheet.getRange(i + 1, TR.STATUS + 1, 1, 5)
        .setValues([[d.status, values[i][TR.APPLIED_AT], d.reviewer, new Date(), d.comment]]);
      Object.keys(_tripMapMemo).forEach(k => delete _tripMapMemo[k]);
      return { ok: true, code: successCode, status: d.status, trip: trip };
    }
    return { ok: false, code: 'ERR_NOT_FOUND' };
  } finally {
    lock.releaseLock();
  }
}
