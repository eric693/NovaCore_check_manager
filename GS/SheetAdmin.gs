// SheetAdmin.gs - 管理員在前端直接檢視／新增／編輯／刪除試算表資料
//
// 設計重點：
// - 只有管理員能用；Session 表放的是登入權杖，看得到就能冒用任何人，完全不開放。
// - 標題列（第 1 列）不能改：後端各處是用欄位位置讀資料，改標題或欄位順序會讓整個系統讀錯欄。
// - 編輯只寫「有變動的格子」，沒動到的格子（包含公式）保持原樣。
// - 送出時帶上編輯前的整列內容，跟目前試算表比對；別人（或系統打卡）先改過、
//   或有人刪列導致列號位移時就拒絕，避免改到／刪到別的資料。
// - 每次異動都寫進「資料編輯紀錄」，這張表只能看不能改。

const SHEET_ADMIN_AUDIT = '資料編輯紀錄';
const SHEET_ADMIN_HIDDEN = [SHEET_SESSION];
const SHEET_ADMIN_READONLY = [SHEET_ADMIN_AUDIT];

function sheetAdminAuth_(token) {
  const session = checkSession_(token);
  if (!session.ok || !session.user) return { error: { ok: false, code: 'ERR_SESSION_INVALID' } };
  if (session.user.dept !== '管理員') return { error: { ok: false, code: 'ERR_NO_PERMISSION' } };
  return { user: session.user };
}

function sheetAdminGetSheet_(name) {
  name = String(name || '');
  if (!name || SHEET_ADMIN_HIDDEN.indexOf(name) >= 0) return null;
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
}

/**
 * 每欄的資料型態，用來把前端送回來的文字轉回原本的型態（日期、數字、布林）
 * 取該欄前 50 筆非空白值中最常見的型態
 */
function sheetAdminColumnTypes_(values, colCount) {
  const types = [];
  for (let c = 0; c < colCount; c++) {
    const count = { date: 0, number: 0, boolean: 0, string: 0 };
    let seen = 0;
    for (let r = 1; r < values.length && seen < 50; r++) {
      const v = values[r][c];
      if (v === '' || v === null) continue;
      seen++;
      if (v instanceof Date) count.date++;
      else if (typeof v === 'number') count.number++;
      else if (typeof v === 'boolean') count.boolean++;
      else count.string++;
    }
    types.push(Object.keys(count).reduce((a, b) => count[b] > count[a] ? b : a, 'string'));
  }
  return types;
}

/**
 * 前端的文字轉成要寫回試算表的值
 */
function sheetAdminConvert_(text, type) {
  const s = String(text === null || text === undefined ? '' : text);
  if (s === '') return '';
  // 不讓前端寫入公式（=、+、-、@ 開頭會被試算表當公式執行），一律存成純文字
  if (/^[=+@]/.test(s) || (/^-/.test(s) && isNaN(Number(s)))) return "'" + s;

  // 數字欄顯示時可能帶千分位（1,200），去掉再轉
  const plain = s.replace(/,/g, '').trim();
  if (type === 'number' && plain !== '' && !isNaN(Number(plain))) return Number(plain);
  if (type === 'boolean' && /^(true|false)$/i.test(s.trim())) return s.trim().toLowerCase() === 'true';
  if (type === 'date') {
    // 只有時間（例如 08:30）就交給試算表自己解析成時間值
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s.trim())) return s.trim();
    const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    const formats = ['yyyy-MM-dd HH:mm:ss', 'yyyy-MM-dd HH:mm', 'yyyy-MM-dd', 'yyyy/MM/dd HH:mm:ss', 'yyyy/MM/dd HH:mm', 'yyyy/MM/dd'];
    for (const f of formats) {
      // parseDate 會接受多餘的字尾，所以長度也要對得上
      if (s.trim().length !== f.length) continue;
      try { return Utilities.parseDate(s.trim(), tz, f); } catch (e) { /* 試下一個格式 */ }
    }
  }
  return s;
}

function sheetAdminAudit_(user, sheetName, rowNumber, action, before, after) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let audit = ss.getSheetByName(SHEET_ADMIN_AUDIT);
  if (!audit) {
    audit = ss.insertSheet(SHEET_ADMIN_AUDIT);
    audit.getRange(1, 1, 1, 7).setValues([['時間', '管理員', '管理員ID', '工作表', '列號', '動作', '內容（修改前 → 修改後）']])
      .setFontWeight('bold');
    audit.setFrozenRows(1);
  }
  audit.appendRow([new Date(), user.name, user.userId, sheetName, rowNumber, action,
    JSON.stringify({ before: before || null, after: after || null }).substring(0, 45000)]);
}

// ==================== API ====================

/**
 * 可管理的工作表清單
 */
function handleSheetAdminList(params) {
  const auth = sheetAdminAuth_(params.token);
  if (auth.error) return auth.error;

  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets()
    .filter(sh => SHEET_ADMIN_HIDDEN.indexOf(sh.getName()) < 0)
    .map(sh => ({
      name: sh.getName(),
      rows: Math.max(sh.getLastRow() - 1, 0),
      readonly: SHEET_ADMIN_READONLY.indexOf(sh.getName()) >= 0
    }));
  return { ok: true, sheets: sheets };
}

/**
 * 讀取整張表：標題 + 所有資料列（試算表上看到的顯示文字）
 * 篩選、搜尋、排序、分頁都在前端做，切換條件不用再等後端。
 */
function handleSheetAdminGet(params) {
  const auth = sheetAdminAuth_(params.token);
  if (auth.error) return auth.error;
  const sheet = sheetAdminGetSheet_(params.sheet);
  if (!sheet) return { ok: false, code: 'ERR_NOT_FOUND' };

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) {
    return { ok: true, name: sheet.getName(), headers: [], types: [], rows: [], readonly: true };
  }

  const range = sheet.getRange(1, 1, lastRow, lastCol);
  const display = range.getDisplayValues();
  const raw = range.getValues();
  const types = sheetAdminColumnTypes_(raw, lastCol);
  const headers = display[0].map((h, i) => h || columnLetter_(i + 1));

  const rows = [];
  for (let r = 1; r < display.length; r++) {
    // 完全空白的列不顯示（刪除內容但沒刪列的情況很常見）
    if (display[r].every(v => v === '')) continue;
    rows.push({ row: r + 1, values: sheetAdminRowText_(raw[r], display[r]) });
  }

  return {
    ok: true,
    name: sheet.getName(),
    headers: headers,
    types: types,
    rows: rows,
    readonly: SHEET_ADMIN_READONLY.indexOf(sheet.getName()) >= 0
  };
}

/**
 * 新增或編輯一列
 * params: sheet, row（編輯時；新增時不帶）, values（JSON 陣列）, original（編輯時，JSON 陣列）
 */
function handleSheetAdminSave(params) {
  const auth = sheetAdminAuth_(params.token);
  if (auth.error) return auth.error;
  const sheet = sheetAdminGetSheet_(params.sheet);
  if (!sheet) return { ok: false, code: 'ERR_NOT_FOUND' };
  if (SHEET_ADMIN_READONLY.indexOf(sheet.getName()) >= 0) return { ok: false, code: 'ERR_SHEET_READONLY' };

  let values, original;
  try {
    values = JSON.parse(params.values || '[]');
    original = params.original ? JSON.parse(params.original) : null;
  } catch (e) {
    return { ok: false, code: 'ERR_INVALID_INPUT' };
  }
  if (!Array.isArray(values)) return { ok: false, code: 'ERR_INVALID_INPUT' };

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'ERR_BUSY' };
  try {
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const lastRow = sheet.getLastRow();
    const sample = lastRow >= 1 ? sheet.getRange(1, 1, Math.min(lastRow, 51), lastCol).getValues() : [[]];
    const types = sheetAdminColumnTypes_(sample, lastCol);

    // ---- 新增 ----
    if (!params.row) {
      if (values.every(v => String(v || '') === '')) return { ok: false, code: 'ERR_EMPTY_ROW' };
      const rowValues = [];
      for (let c = 0; c < lastCol; c++) {
        const v = sheetAdminConvert_(values[c], types[c]);
        if (sheetAdminBadDate_(v, types[c])) return sheetAdminDateError_(sample, c);
        rowValues.push(v);
      }
      sheet.appendRow(rowValues);
      const newRow = sheet.getLastRow();
      sheetAdminAudit_(auth.user, sheet.getName(), newRow, '新增', null, values.slice(0, lastCol));
      return { ok: true, code: 'SHEET_ADMIN_SAVED', row: newRow };
    }

    // ---- 編輯 ----
    const rowNumber = parseInt(params.row, 10);
    if (!(rowNumber >= 2 && rowNumber <= lastRow)) return { ok: false, code: 'ERR_ROW_CHANGED' };
    const rowRange = sheet.getRange(rowNumber, 1, 1, lastCol);
    const current = sheetAdminRowText_(rowRange.getValues()[0], rowRange.getDisplayValues()[0]);
    if (!original || !sheetAdminSameRow_(current, original)) {
      return { ok: false, code: 'ERR_ROW_CHANGED' };
    }

    // 先全部檢查完再寫，避免寫到一半才發現某格日期格式錯
    const changed = [];
    const converted = {};
    for (let c = 0; c < lastCol; c++) {
      const next = values[c] === undefined ? current[c] : String(values[c]);
      if (next === current[c]) continue;
      const v = sheetAdminConvert_(next, types[c]);
      if (sheetAdminBadDate_(v, types[c])) return sheetAdminDateError_(sample, c);
      converted[c] = v;
      changed.push(c);
    }
    changed.forEach(c => sheet.getRange(rowNumber, c + 1).setValue(converted[c]));
    if (changed.length) {
      sheetAdminAudit_(auth.user, sheet.getName(), rowNumber, '編輯',
        changed.map(c => ({ col: c + 1, value: current[c] })),
        changed.map(c => ({ col: c + 1, value: values[c] })));
    }
    return { ok: true, code: 'SHEET_ADMIN_SAVED', row: rowNumber, changed: changed.length };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 刪除一列（params: sheet, row, original）
 */
function handleSheetAdminDelete(params) {
  const auth = sheetAdminAuth_(params.token);
  if (auth.error) return auth.error;
  const sheet = sheetAdminGetSheet_(params.sheet);
  if (!sheet) return { ok: false, code: 'ERR_NOT_FOUND' };
  if (SHEET_ADMIN_READONLY.indexOf(sheet.getName()) >= 0) return { ok: false, code: 'ERR_SHEET_READONLY' };

  let original;
  try {
    original = JSON.parse(params.original || 'null');
  } catch (e) {
    return { ok: false, code: 'ERR_INVALID_INPUT' };
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return { ok: false, code: 'ERR_BUSY' };
  try {
    const rowNumber = parseInt(params.row, 10);
    const lastRow = sheet.getLastRow();
    if (!(rowNumber >= 2 && rowNumber <= lastRow)) return { ok: false, code: 'ERR_ROW_CHANGED' };
    const lastCol = Math.max(sheet.getLastColumn(), 1);
    const rowRange = sheet.getRange(rowNumber, 1, 1, lastCol);
    const current = sheetAdminRowText_(rowRange.getValues()[0], rowRange.getDisplayValues()[0]);
    if (!original || !sheetAdminSameRow_(current, original)) return { ok: false, code: 'ERR_ROW_CHANGED' };

    sheet.deleteRow(rowNumber);
    sheetAdminAudit_(auth.user, sheet.getName(), rowNumber, '刪除', current, null);
    return { ok: true, code: 'SHEET_ADMIN_DELETED' };
  } finally {
    lock.releaseLock();
  }
}

// 日期欄寫進文字的話，後端讀到的就不是 Date，打卡、薪資計算會整列算錯
function sheetAdminBadDate_(value, type) {
  return type === 'date' && typeof value === 'string' && value !== '' &&
         !/^\d{1,2}:\d{2}(:\d{2})?$/.test(value);
}

function sheetAdminDateError_(sample, col) {
  const header = (sample[0] && sample[0][col]) || columnLetter_(col + 1);
  return { ok: false, code: 'ERR_SHEET_ADMIN_BAD_DATE', params: { column: String(header) } };
}

/**
 * 一列的文字表示：日期統一成 yyyy-MM-dd HH:mm:ss（午夜則只有日期），其他用試算表顯示的文字。
 * 顯示格式會隨試算表語系變（例如「2026/10/6 上午 8:30:00」），轉不回去，所以日期不用顯示文字。
 * 只有時間的格子（Google 以 1899-12-30 為基準）格式化會有時區誤差，維持顯示文字。
 */
function sheetAdminRowText_(raw, display) {
  const tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return raw.map((v, i) => {
    if (v instanceof Date && v.getFullYear() >= 1900) {
      const full = Utilities.formatDate(v, tz, 'yyyy-MM-dd HH:mm:ss');
      return full.endsWith(' 00:00:00') ? full.substring(0, 10) : full;
    }
    return display[i];
  });
}

function sheetAdminSameRow_(current, original) {
  for (let c = 0; c < current.length; c++) {
    if (String(current[c]) !== String(original[c] === undefined ? '' : original[c])) return false;
  }
  return true;
}

function columnLetter_(n) {
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
