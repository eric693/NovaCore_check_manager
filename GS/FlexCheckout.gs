// FlexCheckout.gs - 當日工作地點、彈性下班原因申請與審核、打卡定位輔助
//
// 當日工作地點：以當天最後一次「下班」打卡的地點為準（員工當天最後服務的客戶／場所）。
// 彈性下班：第一次上班卡到最後一次下班卡未滿 FLEX_CHECKOUT_MIN_HOURS 小時，
//           員工要填原因，送管理員審核。當天有核准的請假就不需要填。

const FLEX_STATUS_PENDING  = '待審核';
const FLEX_STATUS_APPROVED = '已核准';
const FLEX_STATUS_REJECTED = '已拒絕';

// 員工端「待填寫」只往回找這幾天，避免整張打卡表的舊資料都跳出來
const FLEX_LOOKBACK_DAYS = 14;

const FLEX_HEADERS = [
  '申請ID', '用戶ID', '姓名', '日期', '上班時間', '下班時間', '工作時數',
  '當日工作地點', '彈性下班原因', '狀態', '申請時間', '審核人', '審核時間', '審核意見'
];
// 欄位索引（0 起算），對應 FLEX_HEADERS
const FX = {
  ID: 0, USER_ID: 1, NAME: 2, DATE: 3, IN: 4, OUT: 5, HOURS: 6,
  LOCATION: 7, REASON: 8, STATUS: 9, APPLIED_AT: 10, REVIEWER: 11, REVIEWED_AT: 12, COMMENT: 13
};

// ==================== 打卡定位輔助 ====================

/**
 * GPS 誤差太大時回傳錯誤物件，否則回傳 null。
 * 沒帶 accuracy（舊版前端）就不檢查，避免更新期間整批打不了卡。
 */
function checkPunchAccuracy_(accuracy) {
  const acc = parseFloat(accuracy);
  if (isNaN(acc) || acc <= 0) return null;
  if (acc > MAX_PUNCH_GPS_ACCURACY_M) {
    return {
      ok: false,
      code: 'ERR_LOCATION_INACCURATE',
      params: { accuracy: Math.round(acc) },
      msg: '定位誤差約 ' + Math.round(acc) + ' 公尺，請開啟 GPS／精確位置後再打卡'
    };
  }
  return null;
}

/**
 * 打卡紀錄 F 欄：座標加上誤差，事後查地點爭議時才知道這筆定位可不可信
 */
function formatGpsCell_(lat, lng, accuracy) {
  const acc = parseFloat(accuracy);
  return '(' + lat + ',' + lng + ')' + (acc > 0 ? ' ±' + Math.round(acc) + 'm' : '');
}

/**
 * 地址轉座標（管理員新增打卡地點用）。
 * 走 Apps Script 內建的 Google 地理編碼，台灣門牌的命中率比 OpenStreetMap 高很多；
 * 回傳格式跟 Nominatim 一樣（display_name / lat / lon），前端可以共用顯示邏輯。
 */
function handleGeocodeAddress(params) {
  const session = checkSession_(params.token);
  if (!session.ok || !session.user) return { ok: false, code: 'ERR_SESSION_INVALID' };
  if (session.user.dept !== '管理員') return { ok: false, code: 'ERR_NO_PERMISSION' };

  const query = String(params.q || '').trim();
  if (!query) return { ok: true, results: [] };

  // 「○○里」「○鄰」在地址裡常讓地理編碼失準，第一次找不到就去掉再試
  const variants = [query];
  const stripped = query
    .replace(/([區鄉鎮市])[一-龥]{1,3}里(?=[一-龥\d])/, '$1')
    .replace(/\d+鄰/, '');
  if (stripped !== query) variants.push(stripped);

  try {
    const geocoder = Maps.newGeocoder().setRegion('tw').setLanguage('zh-TW');
    for (const q of variants) {
      const res = geocoder.geocode(q);
      if (res.status === 'OK' && res.results && res.results.length) {
        return {
          ok: true,
          results: res.results.slice(0, 5).map(r => ({
            display_name: r.formatted_address,
            lat: r.geometry.location.lat,
            lon: r.geometry.location.lng,
            precise: r.geometry.location_type === 'ROOFTOP'
          }))
        };
      }
    }
    return { ok: true, results: [] };
  } catch (err) {
    Logger.log('handleGeocodeAddress 錯誤: ' + err);
    return { ok: false, code: 'ERR_GEOCODE_FAILED', msg: err.message };
  }
}

// ==================== 工時與工作地點 ====================

function flexTz_() {
  return Session.getScriptTimeZone();
}

function flexDateKey_(d) {
  return Utilities.formatDate(new Date(d), flexTz_(), 'yyyy-MM-dd');
}

function flexTime_(d) {
  return Utilities.formatDate(new Date(d), flexTz_(), 'HH:mm');
}

/**
 * 把打卡表整理成「每人每天」：第一次上班、最後一次下班、下班地點。
 * @param {Array[]} values 打卡紀錄工作表的 getValues()（含標題列）
 * @param {string} userId 只看這個員工
 * @param {string} [sinceKey] 只看這天（含）之後，yyyy-MM-dd
 * @return {Object} { 'yyyy-MM-dd': { firstIn: Date, lastOut: Date, outLocation: string } }
 */
function collectWorkDays_(values, userId, sinceKey) {
  const days = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row[0] || String(row[1]).trim() !== userId) continue;
    const time = new Date(row[0]);
    if (isNaN(time.getTime())) continue;
    const key = flexDateKey_(time);
    if (sinceKey && key < sinceKey) continue;

    const type = String(row[4]).trim();
    const day = days[key] || (days[key] = { firstIn: null, lastOut: null, outLocation: '' });
    if (type === '上班' && (!day.firstIn || time < day.firstIn)) {
      day.firstIn = time;
    } else if (type === '下班' && (!day.lastOut || time > day.lastOut)) {
      day.lastOut = time;
      day.outLocation = String(row[6] || '');
    }
  }
  return days;
}

function workedHours_(day) {
  if (!day.firstIn || !day.lastOut || day.lastOut <= day.firstIn) return null;
  return Math.round((day.lastOut - day.firstIn) / 36e5 * 100) / 100;
}

/**
 * 員工在這些日期有已核准的請假（半天假的日子工時本來就不會滿）
 */
function approvedLeaveDates_(userId, dateKeys) {
  const months = {};
  dateKeys.forEach(k => { months[k.substring(0, 7)] = true; });
  const leaveDates = {};
  Object.keys(months).forEach(month => {
    try {
      getApprovedLeaveRecords(month, userId).forEach(r => { if (r.date) leaveDates[r.date] = true; });
    } catch (err) {
      Logger.log('approvedLeaveDates_ 讀取請假失敗: ' + err);
    }
  });
  return leaveDates;
}

/**
 * 彈性下班申請表；第一次用到時自動建立
 */
function getFlexCheckoutSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_FLEX_CHECKOUT);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_FLEX_CHECKOUT);
    sheet.getRange(1, 1, 1, FLEX_HEADERS.length).setValues([FLEX_HEADERS])
      .setFontWeight('bold').setBackground('#4285f4').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    // 日期、時間存成文字，避免試算表自動轉成日期物件後時區跑掉
    sheet.getRange('D:F').setNumberFormat('@');
  }
  return sheet;
}

/**
 * 某員工各日期目前有效（待審核／已核准）的申請
 * @return {Object} { 'yyyy-MM-dd': row }
 */
function activeFlexRequestsByDate_(userId) {
  const sheet = getFlexCheckoutSheet_();
  const values = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (String(row[FX.USER_ID]).trim() !== userId) continue;
    const status = String(row[FX.STATUS]).trim();
    if (status === FLEX_STATUS_PENDING || status === FLEX_STATUS_APPROVED) {
      map[normalizeFlexDate_(row[FX.DATE])] = row;
    }
  }
  return map;
}

function normalizeFlexDate_(v) {
  return v instanceof Date ? flexDateKey_(v) : String(v).trim();
}

/**
 * 下班打卡成功後給前端的摘要：當日工作地點、工時、是否要填彈性下班原因。
 * @param {Array[]} values 寫入這筆下班卡「之前」讀到的打卡表
 */
function buildCheckoutSummary_(userId, outTime, outLocation, values) {
  const key = flexDateKey_(outTime);
  const day = collectWorkDays_(values, userId, key)[key] || { firstIn: null, lastOut: null };
  day.lastOut = outTime;

  const hours = workedHours_(day);
  const summary = {
    workDate: key,
    workLocation: outLocation || '',
    workedHours: hours,
    flexRequired: false
  };
  if (hours === null || hours >= FLEX_CHECKOUT_MIN_HOURS) return summary;

  try {
    if (approvedLeaveDates_(userId, [key])[key]) return summary;
    if (activeFlexRequestsByDate_(userId)[key]) return summary;
  } catch (err) {
    Logger.log('buildCheckoutSummary_ 檢查請假／既有申請失敗: ' + err);
  }
  summary.flexRequired = true;
  summary.minHours = FLEX_CHECKOUT_MIN_HOURS;
  return summary;
}

/**
 * 員工近期工時未滿、還沒送出原因的日子（不含今天以後，今天已下班的算在內）
 */
function findFlexPendingDays_(userId) {
  const since = new Date();
  since.setDate(since.getDate() - FLEX_LOOKBACK_DAYS);
  const sinceKey = flexDateKey_(since);

  const days = collectWorkDays_(readAttendanceRowsSince_(since), userId, sinceKey);

  const shortKeys = Object.keys(days).filter(k => {
    const h = workedHours_(days[k]);
    return h !== null && h < FLEX_CHECKOUT_MIN_HOURS;
  });
  if (!shortKeys.length) return [];

  const leave = approvedLeaveDates_(userId, shortKeys);
  const active = activeFlexRequestsByDate_(userId);

  return shortKeys
    .filter(k => !leave[k] && !active[k])
    .sort()
    .map(k => ({
      date: k,
      punchIn: flexTime_(days[k].firstIn),
      punchOut: flexTime_(days[k].lastOut),
      workedHours: workedHours_(days[k]),
      workLocation: days[k].outLocation
    }));
}

// ==================== 員工端 ====================

/**
 * 員工查詢：待填寫的日子 + 自己近期的申請紀錄
 */
function handleGetMyFlexCheckout(params) {
  const session = checkSession_(params.token);
  if (!session.ok || !session.user) return { ok: false, code: 'ERR_SESSION_INVALID' };
  return getMyFlexCheckoutData_(session.user.userId);
}

/**
 * 員工的彈性下班資料；initApp 登入時會一起帶回去，前端不用再多打一支 API
 */
function getMyFlexCheckoutData_(userId) {
  try {
    const sheet = getFlexCheckoutSheet_();
    const values = sheet.getDataRange().getValues();
    const records = [];
    for (let i = values.length - 1; i >= 1 && records.length < 30; i--) {
      const row = values[i];
      if (String(row[FX.USER_ID]).trim() !== userId) continue;
      records.push(flexRowToObject_(row, i + 1));
    }
    return {
      ok: true,
      minHours: FLEX_CHECKOUT_MIN_HOURS,
      pending: findFlexPendingDays_(userId),
      records: records
    };
  } catch (err) {
    Logger.log('handleGetMyFlexCheckout 錯誤: ' + err);
    return { ok: false, code: 'ERR_INTERNAL', msg: err.message };
  }
}

/**
 * 員工送出彈性下班原因。工時由後端重算，不採用前端傳來的數字。
 */
function handleSubmitFlexCheckout(params) {
  const session = checkSession_(params.token);
  if (!session.ok || !session.user) return { ok: false, code: 'ERR_SESSION_INVALID' };
  const user = session.user;

  const date = String(params.date || '').trim();
  const reason = String(params.reason || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, code: 'ERR_INVALID_INPUT' };
  if (reason.length < 2) return { ok: false, code: 'ERR_FLEX_REASON_REQUIRED' };
  if (reason.length > 500) return { ok: false, code: 'ERR_FLEX_REASON_TOO_LONG' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'ERR_BUSY' };
  try {
    const target = findFlexPendingDays_(user.userId).find(d => d.date === date);
    if (!target) {
      // 已經送過、工時其實有滿、或當天有請假
      return { ok: false, code: 'ERR_FLEX_NOT_REQUIRED' };
    }

    const sheet = getFlexCheckoutSheet_();
    const id = 'FX' + Utilities.getUuid().substring(0, 8).toUpperCase();
    const row = [];
    row[FX.ID] = id;
    row[FX.USER_ID] = user.userId;
    row[FX.NAME] = user.name;
    row[FX.DATE] = target.date;
    row[FX.IN] = target.punchIn;
    row[FX.OUT] = target.punchOut;
    row[FX.HOURS] = target.workedHours;
    row[FX.LOCATION] = target.workLocation;
    row[FX.REASON] = reason;
    row[FX.STATUS] = FLEX_STATUS_PENDING;
    row[FX.APPLIED_AT] = new Date();
    row[FX.REVIEWER] = '';
    row[FX.REVIEWED_AT] = '';
    row[FX.COMMENT] = '';
    sheet.appendRow(row);

    try {
      notifyAllAdmins_({
        type: 'text',
        text: '📝 彈性下班原因待審核\n👤 ' + user.name +
              '\n📅 ' + target.date + '（' + target.punchIn + '－' + target.punchOut +
              '，' + target.workedHours + ' 小時）' +
              (target.workLocation ? '\n📍 ' + target.workLocation : '') +
              '\n💬 ' + reason
      });
    } catch (notifyErr) {
      Logger.log('通知管理員失敗（不影響申請）: ' + notifyErr.message);
    }

    return { ok: true, code: 'FLEX_SUBMIT_SUCCESS', id: id };
  } finally {
    lock.releaseLock();
  }
}

// ==================== 管理員端 ====================

function handleGetPendingFlexCheckout(params) {
  const session = checkSession_(params.token);
  if (!session.ok || !session.user) return { ok: false, code: 'ERR_SESSION_INVALID' };
  if (session.user.dept !== '管理員') return { ok: false, code: 'ERR_NO_PERMISSION' };

  const values = getFlexCheckoutSheet_().getDataRange().getValues();
  const requests = [];
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][FX.STATUS]).trim() === FLEX_STATUS_PENDING) {
      requests.push(flexRowToObject_(values[i], i + 1));
    }
  }
  return { ok: true, requests: requests };
}

/**
 * 管理員審核。用申請 ID 找列，不用列號：審核期間有人新增申請，列號不會錯位。
 */
function handleReviewFlexCheckout(params) {
  const session = checkSession_(params.token);
  if (!session.ok || !session.user) return { ok: false, code: 'ERR_SESSION_INVALID' };
  if (session.user.dept !== '管理員') return { ok: false, code: 'ERR_NO_PERMISSION' };

  const id = String(params.id || '').trim();
  const action = String(params.reviewAction || '').trim().toLowerCase();
  if (!id || (action !== 'approve' && action !== 'reject')) return { ok: false, code: 'ERR_INVALID_INPUT' };
  const comment = String(params.comment || '').trim().substring(0, 500);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'ERR_BUSY' };
  try {
    const sheet = getFlexCheckoutSheet_();
    const values = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][FX.ID]).trim() === id) { rowIndex = i; break; }
    }
    if (rowIndex < 0) return { ok: false, code: 'ERR_NOT_FOUND' };

    const row = values[rowIndex];
    if (String(row[FX.STATUS]).trim() !== FLEX_STATUS_PENDING) {
      return { ok: false, code: 'ERR_ALREADY_REVIEWED' };
    }

    const status = action === 'approve' ? FLEX_STATUS_APPROVED : FLEX_STATUS_REJECTED;
    sheet.getRange(rowIndex + 1, FX.STATUS + 1, 1, 5)
      .setValues([[status, row[FX.APPLIED_AT], session.user.name, new Date(), comment]]);

    try {
      const approved = status === FLEX_STATUS_APPROVED;
      sendLineNotification_(String(row[FX.USER_ID]), {
        type: 'text',
        text: (approved ? '✅' : '❌') + ' 您 ' + normalizeFlexDate_(row[FX.DATE]) +
              ' 的彈性下班原因' + (approved ? '已核准' : '未核准') +
              (comment ? '\n💬 ' + comment : '') +
              (approved ? '' : '\n請登入系統重新填寫原因。')
      });
    } catch (notifyErr) {
      Logger.log('通知員工失敗（不影響審核）: ' + notifyErr.message);
    }

    return { ok: true, code: 'FLEX_REVIEW_SUCCESS', status: status };
  } finally {
    lock.releaseLock();
  }
}

function flexRowToObject_(row, rowNumber) {
  return {
    id: String(row[FX.ID]),
    rowNumber: rowNumber,
    userId: String(row[FX.USER_ID]),
    name: String(row[FX.NAME]),
    date: normalizeFlexDate_(row[FX.DATE]),
    punchIn: row[FX.IN] instanceof Date ? flexTime_(row[FX.IN]) : String(row[FX.IN]),
    punchOut: row[FX.OUT] instanceof Date ? flexTime_(row[FX.OUT]) : String(row[FX.OUT]),
    workedHours: Number(row[FX.HOURS]) || 0,
    workLocation: String(row[FX.LOCATION] || ''),
    reason: String(row[FX.REASON] || ''),
    status: String(row[FX.STATUS] || ''),
    appliedAt: row[FX.APPLIED_AT] ? formatDateTime(new Date(row[FX.APPLIED_AT])) : '',
    reviewer: String(row[FX.REVIEWER] || ''),
    reviewedAt: row[FX.REVIEWED_AT] ? formatDateTime(new Date(row[FX.REVIEWED_AT])) : '',
    comment: String(row[FX.COMMENT] || '')
  };
}

/**
 * 給出勤明細用：某月（可指定員工）每天最新一筆申請
 * @return {Object} { userId: { 'yyyy-MM-dd': {status, reason, workedHours, comment} } }
 */
function getFlexCheckoutMap_(monthParam, userIdParam) {
  const map = {};
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_FLEX_CHECKOUT);
  if (!sheet) return map;
  const values = sheet.getDataRange().getValues();
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const date = normalizeFlexDate_(row[FX.DATE]);
    const uid = String(row[FX.USER_ID]).trim();
    if (date.substring(0, 7) !== monthParam) continue;
    if (userIdParam && uid !== userIdParam) continue;
    // 後面的列比較新，被拒後重送的會蓋掉舊的
    (map[uid] || (map[uid] = {}))[date] = {
      status: String(row[FX.STATUS] || ''),
      reason: String(row[FX.REASON] || ''),
      workedHours: Number(row[FX.HOURS]) || 0,
      comment: String(row[FX.COMMENT] || '')
    };
  }
  return map;
}
