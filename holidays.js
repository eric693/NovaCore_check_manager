// 國定假日與工作日判斷（前端共用）
// 清單由後端提供（GS/SalaryManagement.gs 的 TAIWAN_HOLIDAYS），加班與請假都用同一份，
// 只靠星期判斷的話，落在平日的國定假日會被當成一般上班日。

const HOLIDAY_CACHE_KEY = 'holidays_cache';
// 國定假日一年才變一次，但颱風停班日可能臨時新增，所以快取不能放太久
const HOLIDAY_CACHE_TTL_MS = 30 * 60 * 1000;

let nationalHolidays = [];
// 公司停班日 { 'yyyy-MM-dd': '全天' | '下午' }（後端 getHolidays 一起帶回）
let companyClosures = {};

async function loadNationalHolidays() {
    try {
        const cached = JSON.parse(localStorage.getItem(HOLIDAY_CACHE_KEY) || 'null');
        if (cached && Date.now() - cached.savedAt < HOLIDAY_CACHE_TTL_MS && Array.isArray(cached.holidays)) {
            nationalHolidays = cached.holidays;
            companyClosures = cached.closures || {};
            return nationalHolidays;
        }
    } catch {}
    
    try {
        const res = await callApifetch('getHolidays');
        if (res.ok && Array.isArray(res.holidays)) {
            nationalHolidays = res.holidays;
            companyClosures = res.closures || {};
            localStorage.setItem(HOLIDAY_CACHE_KEY, JSON.stringify({
                savedAt: Date.now(),
                holidays: res.holidays,
                closures: companyClosures
            }));
        }
    } catch (err) {
        // 拿不到就只用星期判斷，功能仍可運作
        console.warn('取得國定假日清單失敗，改用星期判斷:', err);
    }
    return nationalHolidays;
}

/** 是不是國定假日（YYYY-MM-DD） */
function isNationalHoliday(dateStr) {
    return !!dateStr && nationalHolidays.includes(dateStr);
}

/** 是不是非工作日：週六、週日或國定假日 */
function isNonWorkingDay(dateStr) {
    if (!dateStr) return false;
    if (isNationalHoliday(dateStr)) return true;
    const day = new Date(`${dateStr}T00:00:00`).getDay();
    return day === 0 || day === 6;
}

/** 加班用：這天是不是整天都算加班（國定假日、例假日、休息日） */
function isFullDayOvertime(dateStr) {
    return isNonWorkingDay(dateStr);
}

/** 公司停班日的範圍：'全天'、'下午' 或 null */
function closureScopeFor(dateStr) {
    return (dateStr && companyClosures[dateStr]) || null;
}
