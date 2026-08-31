/**
 * 排班管理前端邏輯 - 完整版(含月曆功能)
 * 功能: 查看/新增/編輯/刪除排班、批量上傳、月曆顯示、統計分析
 */

// ========== 全域變數 ==========
let currentShifts = [];
let allEmployees = [];
let allLocations = [];
let batchData = [];
let translations = {}; //  新增：翻譯物件
let currentLang = localStorage.getItem("lang") || "zh-TW"; //  新增：當前語言

//  新增：權限控制變數
let currentUserRole = null;
let isAdmin = false;
let isScheduler = false;
// 月曆專用全域變數
let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth(); // 0-11
let allMonthShifts = [];

//  新增：翻譯函式
function t(code, params = {}) {
    let text = translations[code] || code;
    
    for (const key in params) {
        let paramValue = params[key];
        if (paramValue in translations) {
            paramValue = translations[paramValue];
        }
        text = text.replace(`{${key}}`, paramValue);
    }
    return text;
}

//  新增：載入翻譯檔案
async function loadTranslations(lang) {
    try {
        const res = await fetch(`https://eric693.github.io/NovaCore_check_manager/i18n/${lang}.json`);
        if (!res.ok) {
            throw new Error(`HTTP 錯誤: ${res.status}`);
        }
        translations = await res.json();
        currentLang = lang;
        localStorage.setItem("lang", lang);
        renderTranslations();
    } catch (err) {
        console.error("載入語系失敗:", err);
    }
}

//  新增：渲染翻譯
function renderTranslations(container = document) {
    if (container === document) {
        document.title = t("SHIFT_PAGE_TITLE");
    }

    const elementsToTranslate = container.querySelectorAll('[data-i18n]');
    elementsToTranslate.forEach(element => {
        const key = element.getAttribute('data-i18n');
        const translatedText = t(key);
        
        if (translatedText !== key) {
            if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
                element.placeholder = translatedText;
            } else {
                element.textContent = translatedText;
            }
        }
    });

    const selectElements = container.querySelectorAll('select');
    selectElements.forEach(select => {
        const options = select.querySelectorAll('option[data-i18n-option]');
        options.forEach(option => {
            const key = option.getAttribute('data-i18n-option');
            if (key) {
                const translatedText = t(key);
                if (translatedText !== key) {
                    option.textContent = translatedText;
                }
            }
        });
    });
}

// ========== 初始化 ==========
document.addEventListener('DOMContentLoaded', async function() { 
    await loadTranslations(currentLang);
    await loadUserPermissions();
    initializeTabs();
    loadEmployees();
    loadLocations();
    loadShifts();
    setupEventListeners();
    setupBatchUpload();
    
    
    // 設定預設日期為今天
    const today = new Date().toISOString().split('T')[0];
    const shiftDateEl = document.getElementById('shift-date');
    if (shiftDateEl) shiftDateEl.value = today;
    
    // 設定篩選日期為本週
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    
    const filterStartEl = document.getElementById('filter-start-date');
    const filterEndEl = document.getElementById('filter-end-date');
    if (filterStartEl) filterStartEl.value = startOfWeek.toISOString().split('T')[0];
    if (filterEndEl) filterEndEl.value = endOfWeek.toISOString().split('T')[0];
});

// ========== 分頁管理 ==========

function initializeTabs() {
    const tabs = document.querySelectorAll('.shift-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', function() {
            const tabName = this.getAttribute('data-tab');
            //  檢查權限
            if ((tabName === 'add' || tabName === 'batch') && !isAdmin && !isScheduler) {
                showMessage(' 權限不足：只有管理員可以使用此功能', 'error');
                return;
            }
            switchTab(tabName);
        });
    });
}

function switchTab(tabName) {
    document.querySelectorAll('.shift-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`${tabName}-tab`).classList.add('active');
    
    // 載入對應資料
    if (tabName === 'view') {
        loadShifts();
    } else if (tabName === 'stats') {
        loadStats();
    }
}



// ========== 事件監聽器 ==========

function setupEventListeners() {
    const addForm = document.getElementById('add-shift-form');
    if (addForm) {
        addForm.addEventListener('submit', function(e) {
            e.preventDefault();
            addShift();
        });
    }
    
    const shiftTypeEl = document.getElementById('shift-type');
    if (shiftTypeEl) {
        shiftTypeEl.addEventListener('change', function() {
            autoFillShiftTime(this.value);
        });
    }
}


// ==========  權限控制（新增）==========

async function loadUserPermissions() {
    try {
        const token = localStorage.getItem('sessionToken');
        if (!token) {
            console.warn(' 沒有 token');
            isAdmin = false;
            isScheduler = false;
            updateUIForPermissions();
            return;
        }

        const response = await fetch(`${apiUrl}?action=checkSession&token=${token}`);
        const data = await response.json();

        console.log(' checkSession 回應:', data);

        if (data.ok && data.user) {
            currentUserRole = data.user.dept;
            isAdmin = (currentUserRole === '管理員');
            isScheduler = (currentUserRole === '排班人員');
            
            console.log(' 權限載入成功');
            console.log('   角色:', currentUserRole);
            console.log('   isAdmin:', isAdmin);
            console.log('   isScheduler:', isScheduler);
            
            updateUIForPermissions();
        } else {
            console.warn(' Session 無效');
            isAdmin = false;
            isScheduler = false;
            updateUIForPermissions();
        }
    } catch (error) {
        console.error(' 權限載入失敗:', error);
        isAdmin = false;
        isScheduler = false;
        updateUIForPermissions();
    }
}

/**
 * 根據權限更新UI
 */
function updateUIForPermissions() {
    const addTab = document.querySelector('[data-tab="add"]');
    const batchTab = document.querySelector('[data-tab="batch"]');
    
    const canSchedule = isAdmin || isScheduler;
    
    console.log(' 更新 UI 權限');
    console.log('   canSchedule:', canSchedule);
    console.log('   isAdmin:', isAdmin);
    console.log('   isScheduler:', isScheduler);
    
    if (!canSchedule) {
        if (addTab) addTab.style.display = 'none';
        if (batchTab) batchTab.style.display = 'none';
        
        const activeTab = document.querySelector('.shift-tab.active');
        if (activeTab && (activeTab.getAttribute('data-tab') === 'add' || 
            activeTab.getAttribute('data-tab') === 'batch')) {
            switchTab('view');
        }
    } else {
        if (addTab) addTab.style.display = 'block';
        if (batchTab) batchTab.style.display = 'block';
    }
}
/**
 * 檢查管理員權限
 */
function checkSchedulingPermission(actionName) {
    console.log(' 檢查排班權限:', actionName);
    console.log('   isAdmin:', isAdmin);
    console.log('   isScheduler:', isScheduler);
    
    if (!isAdmin && !isScheduler) {
        showMessage(` 權限不足：只有管理員或排班人員可以${actionName}`, 'error');
        return false;
    }
    
    console.log(' 權限檢查通過');
    return true;
}
function autoFillShiftTime(shiftType) {
    const times = {
        // 廚房班別
        '廚房A班': ['11:00', '20:00'],
        '廚房B班': ['11:30', '20:30'],
        '廚房C班': ['12:00', '21:00'],
        '廚房D班': ['13:00', '22:00'],
        '廚房E班': ['14:00', '23:00'],
        '廚房F班': ['15:00', '00:00'],
        '廚房G班': ['11:30', '15:00'],
        '廚房H班': ['18:00', '23:00'],
        '廚房I班': ['18:00', '00:00'],
        
        // 外場班別
        '外場A1班': ['11:00', '20:00'],
        '外場A2班': ['11:30', '16:30'],
        '外場A3班': ['11:30', '17:00'],
        '外場A4班': ['11:30', '20:30'],
        '外場B1班': ['16:00', '01:00'],
        '外場B2班': ['17:00', '01:00'],
        '外場B3班': ['18:00', '01:00'],
        '外場B4班': ['19:00', '01:00'],
        
        // 假別
        '年假': ['00:00', '00:00'],
        '過年假': ['00:00', '00:00'],
        '國定假日': ['00:00', '00:00'],
        '排休': ['00:00', '00:00']
    };
    
    const startTimeInput = document.getElementById('start-time');
    const endTimeInput = document.getElementById('end-time');
    
    // 假別處理
    if (shiftType === '年假' || shiftType === '過年假' || shiftType === '國定假日' || shiftType === '排休') {
        startTimeInput.value = '00:00';
        endTimeInput.value = '00:00';
        startTimeInput.disabled = true;
        endTimeInput.disabled = true;
    } 
    // 自訂班別
    else if (shiftType === '自訂') {
        startTimeInput.value = '';
        endTimeInput.value = '';
        startTimeInput.disabled = false;
        endTimeInput.disabled = false;
        startTimeInput.focus();
    } 
    // 預設班別
    else if (times[shiftType]) {
        startTimeInput.value = times[shiftType][0];
        endTimeInput.value = times[shiftType][1];
        startTimeInput.disabled = false;
        endTimeInput.disabled = false;
    }
}
// ==================== 員工載入函式（完整除錯版） ====================

/**
 *  載入員工列表（加強除錯版）
 */
async function loadEmployees() {
    try {
        const token = localStorage.getItem('sessionToken');
        
        //  步驟 1: 檢查 token
        if (!token) {
            console.error(' 沒有 session token');
            showMessage(t('SHIFT_LOGIN_REQUIRED'), 'error');
            return;
        }
        
        console.log('═══════════════════════════════════════');
        console.log(' 載入員工列表');
        console.log('═══════════════════════════════════════');
        console.log(' Token:', token.substring(0, 20) + '...');
        console.log(' API URL:', apiUrl);
        console.log('');
        
        //  步驟 2: 呼叫 API
        const url = `${apiUrl}?action=getAllUsers&token=${token}`;
        console.log(' 完整 URL:', url);
        console.log(' 開始呼叫 API...');
        
        const response = await fetch(url);
        
        //  步驟 3: 檢查 HTTP 狀態
        console.log(' HTTP 狀態:', response.status, response.statusText);
        
        if (!response.ok) {
            throw new Error(`HTTP 錯誤: ${response.status} ${response.statusText}`);
        }
        
        //  步驟 4: 解析 JSON
        const data = await response.json();
        
        console.log('');
        console.log(' API 回應:');
        console.log('   - ok:', data.ok);
        console.log('   - msg:', data.msg || '無');
        console.log('   - count:', data.count || '無');
        console.log('   - users 存在:', data.users ? '是' : '否');
        console.log('   - users 型別:', typeof data.users);
        console.log('   - users 長度:', data.users ? data.users.length : 'null');
        console.log('');
        
        //  步驟 5: 檢查回應
        if (data.ok) {
            allEmployees = data.users || [];
            
            console.log(' API 回傳成功');
            console.log('   員工數量:', allEmployees.length);
            
            if (allEmployees.length === 0) {
                console.warn(' 員工列表是空的');
                console.warn('   可能原因:');
                console.warn('   1. 員工工作表沒有資料');
                console.warn('   2. 所有員工都不是「啟用」狀態');
                console.warn('   3. 資料格式不正確');
                showMessage(t('SHIFT_NO_EMPLOYEE_DATA'), 'warning');
            } else {
                console.log(' 員工列表預覽（前 5 筆）:');
                allEmployees.slice(0, 5).forEach((emp, index) => {
                    console.log(`   ${index + 1}. ${emp.name} (${emp.userId}) - ${emp.dept}`);
                });
                
                if (allEmployees.length > 5) {
                    console.log(`   ... 還有 ${allEmployees.length - 5} 筆`);
                }
            }
            
            //  步驟 6: 填入下拉選單
            console.log('');
            console.log(' 開始填入員工下拉選單...');
            populateEmployeeSelect();
            
        } else {
            console.error(' API 回傳失敗');
            console.error('   原因:', data.msg || '未知錯誤');
            showMessage(data.msg || t('SHIFT_LOAD_EMPLOYEES_FAILED'), 'error');
        }
        
        console.log('═══════════════════════════════════════');
        
    } catch (error) {
        console.error('');
        console.error(' 載入員工列表失敗');
        console.error('錯誤訊息:', error.message);
        console.error('錯誤堆疊:', error.stack);
        console.error('═══════════════════════════════════════');
        
        showMessage(t('SHIFT_LOAD_EMPLOYEES_ERROR') + ': ' + error.message, 'error');
    }
}

function populateEmployeeSelect() {
    console.log('');
    console.log(' populateEmployeeSelect 開始');
    console.log('───────────────────────────────────────');
    
    const select = document.getElementById('employee-select');
    
    if (!select) {
        console.error(' 找不到 employee-select 元素');
        return;
    }
    
    console.log(' 找到 employee-select 元素');
    
    if (!allEmployees || !Array.isArray(allEmployees)) {
        console.error(' allEmployees 不是有效的陣列');
        return;
    }
    
    console.log(' allEmployees 驗證通過');
    console.log('   員工數量:', allEmployees.length);
    
    // 清空並重設為預設選項
    select.innerHTML = '<option value="">請選擇員工</option>';
    console.log(' 已重設為預設選項');
    
    if (allEmployees.length === 0) {
        console.warn(' 沒有員工可以填入');
        select.innerHTML = '<option value="">目前沒有員工資料</option>';
        return;
    }
    
    // 填入員工選項
    console.log(' 開始逐筆填入...');
    
    let successCount = 0;
    let failCount = 0;
    
    allEmployees.forEach((emp, index) => {
        try {
            if (!emp.userId || !emp.name) {
                console.warn(`    第 ${index + 1} 筆: 缺少必要欄位，跳過`);
                failCount++;
                return;
            }
            
            const option = document.createElement('option');
            option.value = emp.userId;
            option.textContent = `${emp.name} (${emp.userId})`;
            option.dataset.name = emp.name;
            
            if (emp.dept) {
                option.textContent += ` - ${emp.dept}`;
            }
            
            select.appendChild(option);
            successCount++;
            
            if (index < 5) {
                console.log(`    ${index + 1}. ${emp.name} (${emp.userId})`);
            }
            
        } catch (error) {
            console.error(`    第 ${index + 1} 筆失敗:`, error.message);
            failCount++;
        }
    });
    
    if (allEmployees.length > 5) {
        console.log(`   ... 還有 ${allEmployees.length - 5} 筆（已略過顯示）`);
    }
    
    console.log('');
    console.log(' 填入結果:');
    console.log('   成功:', successCount, '筆');
    console.log('   失敗:', failCount, '筆');
    console.log('───────────────────────────────────────');
    console.log(' populateEmployeeSelect 完成');
    console.log('');
    
    //  新增：同時填入篩選下拉框
    populateEmployeeFilter();
}

/**
 *  新增：填入員工篩選下拉框
 */
function populateEmployeeFilter() {
    const filterSelect = document.getElementById('filter-employees');
    
    if (!filterSelect) {
        console.warn(' 找不到 filter-employees 元素');
        return;
    }
    
    console.log(' 開始填入員工篩選下拉框...');
    
    // 保留「全部」選項
    filterSelect.innerHTML = '<option value="">全部</option>';
    
    if (!allEmployees || allEmployees.length === 0) {
        console.warn(' 沒有員工可以填入篩選框');
        return;
    }
    
    allEmployees.forEach(emp => {
        if (!emp.userId || !emp.name) return;
        
        const option = document.createElement('option');
        option.value = emp.userId;
        option.textContent = emp.name;
        
        if (emp.dept) {
            option.textContent += ` (${emp.dept})`;
        }
        
        filterSelect.appendChild(option);
    });
    
    console.log(` 員工篩選下拉框已填入 ${allEmployees.length} 位員工`);
}
// ==================== 除錯工具函式 ====================

/**
 *  手動測試載入員工
 * 在瀏覽器 Console 中執行: testLoadEmployees()
 */
async function testLoadEmployees() {
    console.log(' 手動測試載入員工');
    console.log('');
    
    // 檢查 apiUrl
    console.log('1⃣ 檢查 apiUrl:');
    console.log('   apiUrl:', typeof apiUrl !== 'undefined' ? apiUrl : ' undefined');
    console.log('');
    
    // 檢查 token
    console.log('2⃣ 檢查 token:');
    const token = localStorage.getItem('sessionToken');
    console.log('   token 存在:', token ? ' 是' : ' 否');
    if (token) {
        console.log('   token 預覽:', token.substring(0, 20) + '...');
    }
    console.log('');
    
    // 檢查 HTML 元素
    console.log('3⃣ 檢查 HTML 元素:');
    const select = document.getElementById('employee-select');
    console.log('   employee-select 存在:', select ? ' 是' : ' 否');
    if (select) {
        console.log('   當前選項數量:', select.options.length);
    }
    console.log('');
    
    // 執行載入
    console.log('4⃣ 開始載入員工列表...');
    console.log('');
    
    await loadEmployees();
    
    console.log('');
    console.log('5⃣ 檢查結果:');
    console.log('   allEmployees 存在:', typeof allEmployees !== 'undefined' ? ' 是' : ' 否');
    if (typeof allEmployees !== 'undefined') {
        console.log('   allEmployees 長度:', allEmployees.length);
    }
    if (select) {
        console.log('   下拉選單選項數量:', select.options.length);
    }
}

async function loadLocations() {
    try {
        const token = localStorage.getItem('sessionToken');
        const response = await fetch(`${apiUrl}?action=getLocations&token=${token}`);
        const data = await response.json();
        
        console.log(' 地點列表回應:', data);
        
        if (data.ok) {
            allLocations = data.locations || [];
            populateLocationSelects();
        }
    } catch (error) {
        console.error('載入地點列表失敗:', error);
    }
}

function populateLocationSelects() {
    const selects = ['shift-location', 'filter-location'];
    
    selects.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        
        const currentValue = select.value;
        select.innerHTML = id === 'filter-location' ? 
            '<option value="">全部</option>' : 
            '<option value="">請選擇地點</option>';
        
        allLocations.forEach(loc => {
            const option = document.createElement('option');
            option.value = loc.name;
            option.textContent = loc.name;
            select.appendChild(option);
        });
        
        if (currentValue) select.value = currentValue;
    });
}

async function loadShifts(filters = {}) {
    const listContainer = document.getElementById('shift-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = `<div class="loading">${t('SHIFT_LOADING')}</div>`;
    
    try {
        const token = localStorage.getItem('sessionToken');
        
        // 使用預設日期範圍
        if (!filters.startDate && !filters.endDate) {
            const startDateEl = document.getElementById('filter-start-date');
            const endDateEl = document.getElementById('filter-end-date');
            if (startDateEl && startDateEl.value) filters.startDate = startDateEl.value;
            if (endDateEl && endDateEl.value) filters.endDate = endDateEl.value;
        }
        
        const queryParams = new URLSearchParams({
            action: 'getShifts',
            token: token
        });
        
        if (filters.employeeId) queryParams.append('employeeId', filters.employeeId);
        if (filters.startDate) queryParams.append('startDate', filters.startDate);
        if (filters.endDate) queryParams.append('endDate', filters.endDate);
        if (filters.shiftType) queryParams.append('shiftType', filters.shiftType);
        if (filters.location) queryParams.append('location', filters.location);
        
        const response = await fetch(`${apiUrl}?${queryParams}`);
        const data = await response.json();
        
        console.log(' 排班回應:', data);
        
        if (data.ok) {
            currentShifts = data.data || [];
            displayShifts(currentShifts);
        } else {
            listContainer.innerHTML = `<div class="empty-state"><div class="empty-state-icon"></div><p>${t('SHIFT_LOAD_FAILED')}: ${data.msg}</p></div>`;
        }
    } catch (error) {
        console.error(' 載入排班失敗:', error);
        listContainer.innerHTML = `<div class="empty-state"><div class="empty-state-icon"></div><p>${t('SHIFT_LOAD_ERROR')}</p></div>`;
    }
}

function displayShifts(shifts) {
    const listContainer = document.getElementById('shift-list');
    if (!listContainer) return;
    
    if (shifts.length === 0) {
        listContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon"></div>
                <p>${t('SHIFT_NO_DATA')}</p>
            </div>
        `;
        return;
    }
    
    listContainer.innerHTML = '';
    
    shifts.forEach(shift => {
        const shiftItem = createShiftItem(shift);
        listContainer.appendChild(shiftItem);
    });
}

function createShiftItem(shift) {
    const div = document.createElement('div');
    div.className = 'shift-item';
    
    const shiftTypeBadge = getShiftTypeBadge(shift.shiftType);
    const startTime = formatTimeOnly(shift.startTime);
    const endTime = formatTimeOnly(shift.endTime);
    
    const actionButtons = (isAdmin || isScheduler) ? `
        <div class="shift-actions">
            <button class="btn-icon" onclick="editShift('${shift.shiftId}')">${t('BTN_EDIT')}</button>
            <button class="btn-icon btn-danger" onclick="deleteShift('${shift.shiftId}')">${t('BTN_DELETE')}</button>
        </div>
    ` : '';
    
    div.innerHTML = `
        <div class="shift-info">
            <h3>${shift.employeeName} ${shiftTypeBadge}</h3>
            <p>${t('SHIFT_DATE_LABEL')}: ${formatDate(shift.date)}</p>
            <p>${t('SHIFT_TIME_LABEL')}: ${startTime} - ${endTime}</p>
            <p>${t('SHIFT_LOCATION_LABEL')}: ${shift.location}</p>
            ${shift.note ? `<p>${t('SHIFT_NOTE_LABEL')}: ${shift.note}</p>` : ''}
        </div>
        ${actionButtons}
    `;
    
    return div;
}
// 更新 getShiftTypeBadge 函數以支援新班別
function getShiftTypeBadge(shiftType) {
    const badgeClass = {
        // 廚房班別
        '廚房A班': 'badge-kitchen-a',
        '廚房B班': 'badge-kitchen-b',
        '廚房C班': 'badge-kitchen-c',
        '廚房D班': 'badge-kitchen-d',
        '廚房E班': 'badge-kitchen-e',
        '廚房F班': 'badge-kitchen-f',
        '廚房G班': 'badge-kitchen-g',
        '廚房H班': 'badge-kitchen-h',
        '廚房I班': 'badge-kitchen-i',
        
        // 外場班別
        '外場A1班': 'badge-floor-a1',
        '外場A2班': 'badge-floor-a2',
        '外場A3班': 'badge-floor-a3',
        '外場A4班': 'badge-floor-a4',
        '外場B1班': 'badge-floor-b1',
        '外場B2班': 'badge-floor-b2',
        '外場B3班': 'badge-floor-b3',
        '外場B4班': 'badge-floor-b4',
        
        // 假別
        '年假': 'badge-annual-leave',
        '過年假': 'badge-cny-leave',
        '國定假日': 'badge-national-holiday',
        '排休': 'badge-dayoff',
        '自訂': 'badge-custom'
    }[shiftType] || 'badge-custom';
    
    return `<span class="badge ${badgeClass}">${shiftType}</span>`;
}

function formatDate(dateString) {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
    const weekday = weekdays[date.getDay()];
    
    return `${year}/${month}/${day} (${weekday})`;
}

async function addShift() {
    if (!checkSchedulingPermission('新增排班')) return;
    const employeeSelect = document.getElementById('employee-select');
    const selectedOption = employeeSelect.selectedOptions[0];
    
    if (!selectedOption || !selectedOption.value) {
        showMessage(t('SHIFT_SELECT_EMPLOYEE'), 'error');
        return;
    }
    
    const shiftType = document.getElementById('shift-type').value;
    const startTime = document.getElementById('start-time').value;
    const endTime = document.getElementById('end-time').value;
    
    // 驗證時間欄位
    if (!startTime || !endTime) {
        showMessage(t('SHIFT_FILL_TIME'), 'error');
        return;
    }
    
    // 驗證時間邏輯(結束時間應該晚於開始時間,除非是跨日班)
    if (startTime >= endTime && endTime !== '00:00') {
        const confirmCrossDay = confirm(t('SHIFT_CONFIRM_CROSS_DAY'));
        if (!confirmCrossDay) {
            return;
        }
    }
    
    const token = localStorage.getItem('sessionToken');
    const shiftNoteEl = document.getElementById('shift-note');
    
    const shiftData = {
        action: 'addShift',
        token: token,
        employeeId: selectedOption.value,
        employeeName: selectedOption.dataset.name || selectedOption.textContent.split('(')[0].trim(),
        date: document.getElementById('shift-date').value,
        shiftType: shiftType,
        startTime: startTime,
        endTime: endTime,
        location: document.getElementById('shift-location').value,
        note: shiftNoteEl ? shiftNoteEl.value : ''
    };
    
    console.log(' 新增排班:', shiftData);
    
    try {
        const queryParams = new URLSearchParams(shiftData);
        const response = await fetch(`${apiUrl}?${queryParams}`);
        const data = await response.json();
        
        console.log(' 新增回應:', data);
        
        if (data.ok) {
            showMessage(t('SHIFT_ADD_SUCCESS'), 'success');
            resetForm();
            switchTab('view');
            loadShifts();
        } else {
            showMessage(data.msg || t('SHIFT_ADD_FAILED'), 'error');
        }
    } catch (error) {
        console.error(' 新增排班失敗:', error);
        showMessage(t('SHIFT_ADD_ERROR'), 'error');
    }
}

async function editShift(shiftId) {
    if (!checkSchedulingPermission('編輯排班')) return; 
    const shift = currentShifts.find(s => s.shiftId === shiftId);
    if (!shift) return;
    
    switchTab('add');
    
    document.querySelector('#add-tab h2').textContent = t('SHIFT_EDIT_TITLE');
    document.getElementById('employee-select').value = shift.employeeId;
    document.getElementById('shift-date').value = shift.date;
    document.getElementById('shift-type').value = shift.shiftType;
    
    // 格式化時間
    document.getElementById('start-time').value = formatTimeOnly(shift.startTime);
    document.getElementById('end-time').value = formatTimeOnly(shift.endTime);
    
    document.getElementById('shift-location').value = shift.location;
    
    const shiftNoteEl = document.getElementById('shift-note');
    if (shiftNoteEl) shiftNoteEl.value = shift.note || '';
    
    const submitBtn = document.querySelector('#add-shift-form button[type="submit"]');
    submitBtn.textContent = t('BTN_UPDATE_SHIFT');
    submitBtn.onclick = function(e) {
        e.preventDefault();
        updateShift(shiftId);
    };
}

async function updateShift(shiftId) {
    
    if (!checkSchedulingPermission('編輯排班')) return;
    const employeeSelect = document.getElementById('employee-select');
    const selectedOption = employeeSelect.selectedOptions[0];
    
    if (!selectedOption || !selectedOption.value) {
        showMessage(t('SHIFT_SELECT_EMPLOYEE'), 'error');
        return;
    }
    
    const token = localStorage.getItem('sessionToken');
    const shiftNoteEl = document.getElementById('shift-note');
    
    const shiftData = {
        action: 'updateShift',
        token: token,
        shiftId: shiftId,
        employeeId: selectedOption.value,
        employeeName: selectedOption.dataset.name || selectedOption.textContent.split('(')[0].trim(),
        date: document.getElementById('shift-date').value,
        shiftType: document.getElementById('shift-type').value,
        startTime: document.getElementById('start-time').value,
        endTime: document.getElementById('end-time').value,
        location: document.getElementById('shift-location').value,
        note: shiftNoteEl ? shiftNoteEl.value : ''
    };
    
    try {
        const queryParams = new URLSearchParams(shiftData);
        const response = await fetch(`${apiUrl}?${queryParams}`);
        const data = await response.json();
        
        if (data.ok) {
            showMessage(t('SHIFT_UPDATE_SUCCESS'), 'success');
            resetForm();
            switchTab('view');
            loadShifts();
        } else {
            showMessage(data.msg || t('SHIFT_UPDATE_FAILED'), 'error');
        }
    } catch (error) {
        console.error(' 更新排班失敗:', error);
        showMessage(t('SHIFT_UPDATE_ERROR'), 'error');
    }
}

async function deleteShift(shiftId) {
    if (!checkSchedulingPermission('刪除排班')) return;
    if (!confirm(t('SHIFT_DELETE_CONFIRM'))) return;
    
    try {
        const token = localStorage.getItem('sessionToken');
        const url = `${apiUrl}?action=deleteShift&token=${token}&shiftId=${shiftId}`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.ok) {
            showMessage(t('SHIFT_DELETE_SUCCESS'), 'success');
            loadShifts();
        } else {
            showMessage(data.msg || t('SHIFT_DELETE_FAILED'), 'error');
        }
    } catch (error) {
        console.error(' 刪除排班失敗:', error);
        showMessage(t('SHIFT_DELETE_ERROR'), 'error');
    }
}

function filterShifts() {
    const filters = {};
    
    const startDateEl = document.getElementById('filter-start-date');
    const endDateEl = document.getElementById('filter-end-date');
    const shiftTypeEl = document.getElementById('filter-shift-type');
    const locationEl = document.getElementById('filter-location');
    
    //  新增：取得選擇的員工（多選）
    const employeesEl = document.getElementById('filter-employees');
    const selectedEmployees = Array.from(employeesEl.selectedOptions)
        .map(opt => opt.value)
        .filter(val => val !== ''); // 過濾掉「全部」選項
    
    if (startDateEl && startDateEl.value) filters.startDate = startDateEl.value;
    if (endDateEl && endDateEl.value) filters.endDate = endDateEl.value;
    if (shiftTypeEl && shiftTypeEl.value) filters.shiftType = shiftTypeEl.value;
    if (locationEl && locationEl.value) filters.location = locationEl.value;
    
    //  新增：如果有選擇員工，加入篩選條件
    if (selectedEmployees.length > 0) {
        filters.employeeIds = selectedEmployees;
    }
    
    console.log(' 篩選條件:', filters);
    
    loadShiftsWithMultipleEmployees(filters);
}
function clearFilters() {
    const shiftTypeEl = document.getElementById('filter-shift-type');
    const locationEl = document.getElementById('filter-location');
    const employeesEl = document.getElementById('filter-employees');  //  新增
    
    if (shiftTypeEl) shiftTypeEl.value = '';
    if (locationEl) locationEl.value = '';
    
    //  新增：清除員工多選
    if (employeesEl) {
        Array.from(employeesEl.options).forEach(option => {
            option.selected = false;
        });
    }
    
    // 重設為本週
    const startOfWeek = new Date();
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 6);
    
    document.getElementById('filter-start-date').value = startOfWeek.toISOString().split('T')[0];
    document.getElementById('filter-end-date').value = endOfWeek.toISOString().split('T')[0];
    
    loadShifts();
}

function exportShifts() {
    if (currentShifts.length === 0) {
        showMessage(t('SHIFT_NO_EXPORT_DATA'), 'error');
        return;
    }
    
    const csv = convertToCSV(currentShifts);
    const filename = `排班表_${new Date().toISOString().split('T')[0]}.csv`;
    downloadCSV(csv, filename);
    showMessage(t('SHIFT_EXPORT_SUCCESS'), 'success');
}

function convertToCSV(data) {
    const headers = ['排班ID', '員工ID', '員工姓名', '日期', '班別', '上班時間', '下班時間', '地點', '備註'];
    const rows = data.map(shift => [
        shift.shiftId,
        shift.employeeId,
        shift.employeeName,
        shift.date,
        shift.shiftType,
        shift.startTime,
        shift.endTime,
        shift.location,
        shift.note || ''
    ]);
    
    const csvContent = [headers, ...rows]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');
    
    return '\ufeff' + csvContent;
}

function downloadCSV(csv, filename) {
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
}

function resetForm() {
    const form = document.getElementById('add-shift-form');
    if (form) form.reset();
    
    document.querySelector('#add-tab h2').textContent = t('SHIFT_ADD_TITLE');
    
    const submitBtn = document.querySelector('#add-shift-form button[type="submit"]');
    if (submitBtn) {
        submitBtn.textContent = t('BTN_ADD_SHIFT');
        submitBtn.onclick = null;
    }
    
    const today = new Date().toISOString().split('T')[0];
    const shiftDateEl = document.getElementById('shift-date');
    if (shiftDateEl) shiftDateEl.value = today;
}

// ========== 批量上傳 ==========

function setupBatchUpload() {
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('batch-file-input');
    
    if (!uploadArea || !fileInput) return;
    
    uploadArea.addEventListener('dragover', function(e) {
        e.preventDefault();
        this.classList.add('drag-over');
    });
    
    uploadArea.addEventListener('dragleave', function() {
        this.classList.remove('drag-over');
    });
    
    uploadArea.addEventListener('drop', function(e) {
        e.preventDefault();
        this.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            handleBatchFile(files[0]);
        }
    });
    
    fileInput.addEventListener('change', function() {
        if (this.files.length > 0) {
            handleBatchFile(this.files[0]);
        }
    });
}


/**
 *  新增：支援多員工篩選的載入函數
 */
async function loadShiftsWithMultipleEmployees(filters = {}) {
    const listContainer = document.getElementById('shift-list');
    if (!listContainer) return;
    
    listContainer.innerHTML = `<div class="loading">${t('SHIFT_LOADING')}</div>`;
    
    try {
        const token = localStorage.getItem('sessionToken');
        
        // 使用預設日期範圍
        if (!filters.startDate && !filters.endDate) {
            const startDateEl = document.getElementById('filter-start-date');
            const endDateEl = document.getElementById('filter-end-date');
            if (startDateEl && startDateEl.value) filters.startDate = startDateEl.value;
            if (endDateEl && endDateEl.value) filters.endDate = endDateEl.value;
        }
        
        //  如果有多個員工，需要多次呼叫 API 然後合併結果
        let allShifts = [];
        
        if (filters.employeeIds && filters.employeeIds.length > 0) {
            console.log(` 查詢 ${filters.employeeIds.length} 位員工的排班...`);
            
            for (const employeeId of filters.employeeIds) {
                const queryParams = new URLSearchParams({
                    action: 'getShifts',
                    token: token,
                    employeeId: employeeId
                });
                
                if (filters.startDate) queryParams.append('startDate', filters.startDate);
                if (filters.endDate) queryParams.append('endDate', filters.endDate);
                if (filters.shiftType) queryParams.append('shiftType', filters.shiftType);
                if (filters.location) queryParams.append('location', filters.location);
                
                const response = await fetch(`${apiUrl}?${queryParams}`);
                const data = await response.json();
                
                if (data.ok && data.data) {
                    allShifts = allShifts.concat(data.data);
                }
            }
            
            console.log(` 總共找到 ${allShifts.length} 筆排班`);
            
        } else {
            // 沒有選擇員工，使用原本的邏輯
            const queryParams = new URLSearchParams({
                action: 'getShifts',
                token: token
            });
            
            if (filters.startDate) queryParams.append('startDate', filters.startDate);
            if (filters.endDate) queryParams.append('endDate', filters.endDate);
            if (filters.shiftType) queryParams.append('shiftType', filters.shiftType);
            if (filters.location) queryParams.append('location', filters.location);
            
            const response = await fetch(`${apiUrl}?${queryParams}`);
            const data = await response.json();
            
            if (data.ok) {
                allShifts = data.data || [];
            }
        }
        
        // 去除重複的排班（根據 shiftId）
        const uniqueShifts = Array.from(
            new Map(allShifts.map(shift => [shift.shiftId, shift])).values()
        );
        
        // 按日期排序
        uniqueShifts.sort((a, b) => new Date(a.date) - new Date(b.date));
        
        currentShifts = uniqueShifts;
        displayShifts(currentShifts);
        
    } catch (error) {
        console.error(' 載入排班失敗:', error);
        listContainer.innerHTML = `<div class="empty-state"><div class="empty-state-icon"></div><p>${t('SHIFT_LOAD_ERROR')}</p></div>`;
    }
}
function handleBatchFile(file) {
    const fileName = file.name.toLowerCase();
    
    if (fileName.endsWith('.csv')) {
        // CSV 處理（原有邏輯）
        const reader = new FileReader();
        reader.onload = function(e) {
            let content = e.target.result;
            parseBatchData(content, file.name);
        };
        reader.readAsText(file, 'UTF-8');
        
    } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const data = new Uint8Array(e.target.result);
                //  加上 cellDates: true，讓日期保持 Date 物件
                const workbook = XLSX.read(data, { type: 'array', cellDates: true });
                
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                
                //  指定日期格式為 YYYY-MM-DD
                const csv = XLSX.utils.sheet_to_csv(worksheet, { 
                    dateNF: 'yyyy-mm-dd' 
                });
                
                parseBatchData(csv, file.name);
                
            } catch (error) {
                console.error('Excel 解析失敗:', error);
                showMessage('Excel 檔案解析失敗，請確認格式正確', 'error');
            }
        };
        reader.readAsArrayBuffer(file);
        
    } else {
        showMessage('僅支援 CSV、XLS、XLSX 格式', 'error');
    }
}
function parseBatchData(content, filename) {
    // 移除 BOM (如果有的話)
    content = content.replace(/^\ufeff/, '');
    
    const lines = content.split('\n');
    const data = [];
    
    console.log('═══════════════════════════════════════');
    console.log(' 開始解析批量上傳檔案');
    console.log('═══════════════════════════════════════');
    console.log('檔案名稱:', filename);
    console.log('總行數:', lines.length);
    console.log('');
    
    // 從第二行開始(跳過標題)
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        //  正確處理 CSV 引號
        const values = parseCSVLine(line);
        
        console.log(`第 ${i + 1} 行解析結果:`);
        console.log('  原始內容:', line.substring(0, 100) + (line.length > 100 ? '...' : ''));
        console.log('  解析欄位數:', values.length);
        
        //  修正：CSV 範本格式為：員工ID, 員工姓名, 日期, 班別, 上班時間, 下班時間, 地點, 備註
        // 檢查是否有足夠的欄位(至少 6 個)
        if (values.length >= 6) {
            const shift = {
                employeeId: values[0],      //  第 1 欄: 員工ID
                employeeName: values[1],    //  第 2 欄: 員工姓名
                date: values[2],            //  第 3 欄: 日期
                shiftType: values[3],       //  第 4 欄: 班別
                startTime: values[4],       //  第 5 欄: 上班時間
                endTime: values[5],         //  第 6 欄: 下班時間
                location: values[6] || '',  //  第 7 欄: 地點
                note: values[7] || ''       //  第 8 欄: 備註
            };
            
            console.log('   解析結果:');
            console.log('    員工ID:', shift.employeeId);
            console.log('    員工姓名:', shift.employeeName);
            console.log('    日期:', shift.date);
            console.log('    班別:', shift.shiftType);
            console.log('    上班時間:', shift.startTime);
            console.log('    下班時間:', shift.endTime);
            console.log('    地點:', shift.location);
            
            //  標準化日期格式（處理 2026/2/2 → 2026-02-02）
            if (shift.date && shift.date.includes('/')) {
                const parts = shift.date.split('/');
                shift.date = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
            }
            // 驗證必填欄位
            if (shift.employeeId && shift.date && shift.shiftType) {
                data.push(shift);
                console.log('   第', i + 1, '行資料有效');
            } else {
                console.warn('   第', i + 1, '行資料不完整,已略過');
                console.warn('    缺少欄位:');
                if (!shift.employeeId) console.warn('      - 員工ID');
                if (!shift.date) console.warn('      - 日期');
                if (!shift.shiftType) console.warn('      - 班別');
            }
        } else {
            console.warn('   第', i + 1, '行欄位不足');
            console.warn('    需要: 至少 6 欄 (員工ID, 姓名, 日期, 班別, 開始, 結束)');
            console.warn('    實際:', values.length, '欄');
            console.warn('    內容:', values);
        }
        console.log('');
    }
    
    console.log('═══════════════════════════════════════');
    console.log(' 解析完成');
    console.log('有效資料筆數:', data.length);
    console.log('═══════════════════════════════════════');
    console.log('');
    
    if (data.length === 0) {
        showMessage(t('SHIFT_BATCH_NO_DATA'), 'error');
        return;
    }
    
    batchData = data;
    displayBatchPreview(data);
}

/**
 *  正確解析 CSV 行(處理引號)
 */
function parseCSVLine(line) {
    const values = [];
    let currentValue = '';
    let insideQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        const nextChar = line[i + 1];
        
        if (char === '"') {
            if (insideQuotes && nextChar === '"') {
                // 兩個連續的引號 = 一個引號字元
                currentValue += '"';
                i++; // 跳過下一個引號
            } else {
                // 切換引號狀態
                insideQuotes = !insideQuotes;
            }
        } else if (char === ',' && !insideQuotes) {
            // 在引號外的逗號 = 欄位分隔符
            values.push(currentValue.trim());
            currentValue = '';
        } else {
            currentValue += char;
        }
    }
    
    // 加入最後一個欄位
    values.push(currentValue.trim());
    
    return values;
}

function displayBatchPreview(data) {
    const previewDiv = document.getElementById('batch-preview');
    const tableDiv = document.getElementById('preview-table');
    
    if (!previewDiv || !tableDiv) return;
    
    let html = '<div style="overflow-x: auto;">'; // 加入水平捲動容器
    html += '<table style="width: 100%; border-collapse: collapse; min-width: 1200px;">'; // 設定最小寬度
    
    //  表頭：顯示所有欄位
    html += '<tr style="background: #f5f5f5;">';
    html += '<th style="padding: 12px; border: 1px solid #ddd; text-align: left; white-space: nowrap;">員工ID</th>';
    html += '<th style="padding: 12px; border: 1px solid #ddd; text-align: left; white-space: nowrap;">員工姓名</th>';
    html += '<th style="padding: 12px; border: 1px solid #ddd; text-align: left; white-space: nowrap;">日期</th>';
    html += '<th style="padding: 12px; border: 1px solid #ddd; text-align: left; white-space: nowrap;">班別</th>';
    html += '<th style="padding: 12px; border: 1px solid #ddd; text-align: left; white-space: nowrap;">上班時間</th>';
    html += '<th style="padding: 12px; border: 1px solid #ddd; text-align: left; white-space: nowrap;">下班時間</th>';
    html += '<th style="padding: 12px; border: 1px solid #ddd; text-align: left; white-space: nowrap;">地點</th>';
    html += '<th style="padding: 12px; border: 1px solid #ddd; text-align: left; min-width: 150px;">備註</th>'; //  新增備註欄
    html += '</tr>';
    
    //  資料列：顯示前 20 筆資料（增加顯示筆數）
    data.slice(0, 20).forEach((row, index) => {
        html += '<tr style="border-bottom: 1px solid #eee;">';
        html += `<td style="padding: 10px; border: 1px solid #ddd; font-size: 12px; font-family: monospace;">${row.employeeId || ''}</td>`;
        html += `<td style="padding: 10px; border: 1px solid #ddd;">${row.employeeName || ''}</td>`;
        html += `<td style="padding: 10px; border: 1px solid #ddd; white-space: nowrap;">${row.date || ''}</td>`;
        html += `<td style="padding: 10px; border: 1px solid #ddd; white-space: nowrap;">${row.shiftType || ''}</td>`;
        html += `<td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${row.startTime || ''}</td>`;
        html += `<td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${row.endTime || ''}</td>`;
        html += `<td style="padding: 10px; border: 1px solid #ddd;">${row.location || ''}</td>`;
        html += `<td style="padding: 10px; border: 1px solid #ddd; max-width: 200px; word-wrap: break-word;">${row.note || ''}</td>`; //  顯示備註
        html += '</tr>';
    });
    
    //  如果資料超過 20 筆，顯示提示
    if (data.length > 20) {
        html += `<tr><td colspan="8" style="text-align: center; padding: 10px; color: #666; background: #f9f9f9;">還有 ${data.length - 20} 筆資料...</td></tr>`;
    }
    
    html += '</table>';
    html += '</div>'; // 結束捲動容器
    
    tableDiv.innerHTML = html;
    previewDiv.style.display = 'block';
    document.getElementById('upload-area').style.display = 'none';
    
    console.log(' 預覽表格已顯示，共', data.length, '筆資料');
}

/**
 *  批量上傳（使用 FormData 避免 CORS）
 */
async function confirmBatchUpload() {
    if (!checkSchedulingPermission('批量上傳')) return;
    if (batchData.length === 0) return;
    
    try {
        const token = localStorage.getItem('sessionToken');
        
        console.log(' 準備上傳批量資料:', batchData.length, '筆');
        console.log(' 前 3 筆資料預覽:', batchData.slice(0, 3));
        
        //  使用 URLSearchParams（不會觸發 preflight）
        const formData = new URLSearchParams();
        formData.append('action', 'batchAddShifts');
        formData.append('token', token);
        formData.append('shiftsArray', JSON.stringify(batchData));
        
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: formData
        });
        
        console.log(' HTTP 狀態:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP 錯誤: ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log(' 批量上傳回應:', data);
        console.log(' 詳細結果:');
        console.log('   成功:', data.results?.success || 0);
        console.log('   失敗:', data.results?.failed || 0);
        if (data.results?.errors && data.results.errors.length > 0) {
            console.log('   錯誤列表:');
            data.results.errors.forEach((err, i) => {
                console.log(`     ${i + 1}. ${err}`);
            });
        }
       
        if (data.ok || data.success) {
            showMessage(data.msg || data.message || '批量上傳成功！', 'success');
            cancelBatchUpload();
            switchTab('view');
            loadShifts();
        } else {
            let errorMsg = data.msg || data.message || '批量上傳失敗';
            
            if (data.results && data.results.errors && data.results.errors.length > 0) {
                errorMsg += '\n\n錯誤詳情：\n' + data.results.errors.slice(0, 5).join('\n');
                if (data.results.errors.length > 5) {
                    errorMsg += `\n...還有 ${data.results.errors.length - 5} 個錯誤`;
                }
            }
            
            showMessage(errorMsg, 'error');
        }
        
    } catch (error) {
        console.error(' 批量上傳失敗:', error);
        console.error('錯誤堆疊:', error.stack);
        
        let errorMsg = '批量上傳失敗：' + error.message;
        
        if (error.message.includes('Failed to fetch')) {
            errorMsg = '網路連線失敗，請檢查：\n1. 網路連線是否正常\n2. API 網址是否正確\n3. 伺服器是否運作中';
        } else if (error.message.includes('CORS')) {
            errorMsg = 'CORS 錯誤，請確認：\n1. Google Apps Script 已正確部署\n2. 使用的是正確的部署 URL';
        }
        
        showMessage(errorMsg, 'error');
    }
}
function cancelBatchUpload() {
    batchData = [];
    const previewDiv = document.getElementById('batch-preview');
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('batch-file-input');
    
    if (previewDiv) previewDiv.style.display = 'none';
    if (uploadArea) uploadArea.style.display = 'block';
    if (fileInput) fileInput.value = '';
}

function downloadTemplate() {
    //  包含所有班別類型：廚房、外場、年假（特休）、過年假、排休
    const template = '員工ID,員工姓名,日期,班別,上班時間,下班時間,地點,備註\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-01,廚房A班,11:00,20:00,總公司,\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-02,廚房B班,11:30,20:30,分公司,\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-03,廚房C班,12:00,21:00,總公司,\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-04,外場A1班,11:00,20:00,總公司,\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-05,外場B1班,16:00,01:00,分公司,跨日班\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-06,廚房G班,11:30,15:00,總公司,短班\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-07,外場A2班,11:30,16:30,總公司,\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-08,年假,00:00,00:00,總公司,年假(特休)\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-09,過年假,00:00,00:00,總公司,春節假期\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-10,排休,00:00,00:00,總公司,一般休假\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-11,廚房H班,18:00,23:00,分公司,\n' +
                    'Ue76b65367821240ac26387d2972a5adf,洪培瑜Eric,2026-02-12,外場B3班,18:00,01:00,總公司,跨日班';
    
    downloadCSV(template, '排班範本.csv');
    
    console.log(' 範本檔案已下載');
    console.log('   共 12 筆測試資料');
    console.log('   包含：廚房班別、外場班別、年假(特休)、過年假、國定假日、排休');
    console.log('   格式: 員工ID, 員工姓名, 日期, 班別, 上班時間, 下班時間, 地點, 備註');
    
    showMessage(' 範本下載成功！包含所有班別類型（含年假和過年假），請依照範本格式填寫', 'success');
}








// ========== 月曆功能 ==========

async function loadStats() {
    try {
        currentYear = new Date().getFullYear();
        currentMonth = new Date().getMonth();
        
        updateMonthDisplay();
        await loadMonthlyStats();
        await loadMonthlyShifts();
        await loadShiftDistribution();
    } catch (error) {
        console.error('載入統計失敗:', error);
    }
}

function updateMonthDisplay() {
    const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', 
                        '7月', '8月', '9月', '10月', '11月', '12月'];
    const displayText = `${currentYear}年${monthNames[currentMonth]}`;
    const monthEl = document.getElementById('current-month');
    if (monthEl) monthEl.textContent = displayText;
}

function previousMonth() {
    currentMonth--;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    }
    updateMonthDisplay();
    loadMonthlyStats();
    loadMonthlyShifts();
    loadShiftDistribution();
}

function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }
    updateMonthDisplay();
    loadMonthlyStats();
    loadMonthlyShifts();
    loadShiftDistribution();
}

function goToToday() {
    const today = new Date();
    currentYear = today.getFullYear();
    currentMonth = today.getMonth();
    updateMonthDisplay();
    loadMonthlyStats();
    loadMonthlyShifts();
    loadShiftDistribution();
}

async function loadMonthlyStats() {
    try {
        const token = localStorage.getItem('sessionToken');
        const startDate = new Date(currentYear, currentMonth, 1);
        const endDate = new Date(currentYear, currentMonth + 1, 0);
        
        const queryParams = new URLSearchParams({
            action: 'getShifts',
            token: token,
            startDate: formatDateYMD(startDate),
            endDate: formatDateYMD(endDate)
        });
        
        const response = await fetch(`${apiUrl}?${queryParams}`);
        const data = await response.json();
        
        console.log(' 月度統計:', data);
        
        if (data.ok && data.data) {
            allMonthShifts = data.data;
            displayMonthlyStats(data.data);
        }
    } catch (error) {
        console.error('載入月度統計失敗:', error);
    }
}


// 更新 displayMonthlyStats 函數以支援新班別統計
function displayMonthlyStats(shifts) {
    const statsGrid = document.getElementById('stats-grid');
    if (!statsGrid) return;
    
    const stats = {
        total: shifts.length,
        kitchenShifts: 0,
        floorShifts: 0,
        annualLeave: 0,
        cnyLeave: 0,
        nationalHoliday: 0,
        dayoff: 0,
        custom: 0
    };
    
    shifts.forEach(shift => {
        if (shift.shiftType.startsWith('廚房')) {
            stats.kitchenShifts++;
        } else if (shift.shiftType.startsWith('外場')) {
            stats.floorShifts++;
        } else {
            switch(shift.shiftType) {
                case '年假': stats.annualLeave++; break;
                case '過年假': stats.cnyLeave++; break;
                case '國定假日': stats.nationalHoliday++; break;
                case '排休': stats.dayoff++; break;
                case '自訂': stats.custom++; break;
            }
        }
    });
    
    const html = `
        <div class="stat-card">
            <div class="stat-label">${t('SHIFT_STATS_TOTAL')}</div>
            <div class="stat-value">${stats.total}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">廚房班別</div>
            <div class="stat-value" style="color: #ff9800;">${stats.kitchenShifts}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">外場班別</div>
            <div class="stat-value" style="color: #2196f3;">${stats.floorShifts}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">年假(特休)</div>
            <div class="stat-value" style="color: #4caf50;">${stats.annualLeave}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">過年假</div>
            <div class="stat-value" style="color: #f44336;">${stats.cnyLeave}</div>
        </div>
        <!--  新增國定假日統計 -->
        <div class="stat-card">
            <div class="stat-label">國定假日</div>
            <div class="stat-value" style="color: #ff9800;">${stats.nationalHoliday}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">排休</div>
            <div class="stat-value" style="color: #757575;">${stats.dayoff}</div>
        </div>
        ${stats.custom > 0 ? `
        <div class="stat-card">
            <div class="stat-label">${t('SHIFT_TYPE_CUSTOM')}</div>
            <div class="stat-value" style="color: #fbc02d;">${stats.custom}</div>
        </div>
        ` : ''}
    `;
    
    statsGrid.innerHTML = html;
}


async function loadMonthlyShifts() {
    const calendarGrid = document.getElementById('calendar-grid');
    if (!calendarGrid) return;
    
    calendarGrid.innerHTML = '<div class="loading">載入月曆中</div>';
    
    try {
        displayMonthCalendar(allMonthShifts);
    } catch (error) {
        console.error('載入月曆失敗:', error);
        calendarGrid.innerHTML = '<div class="loading">載入失敗</div>';
    }
}

function displayMonthCalendar(shifts) {
    const calendarGrid = document.getElementById('calendar-grid');
    if (!calendarGrid) return;
    
    const firstDay = new Date(currentYear, currentMonth, 1);
    const lastDay = new Date(currentYear, currentMonth + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    const prevMonthLastDay = new Date(currentYear, currentMonth, 0).getDate();
    
    const today = new Date();
    const todayStr = formatDateYMD(today);
    
    let html = '';
    let dayCounter = 1;
    let nextMonthDay = 1;
    
    const totalCells = Math.ceil((daysInMonth + startingDayOfWeek) / 7) * 7;
    
    for (let i = 0; i < totalCells; i++) {
        let dateStr = '';
        let dayNumber = '';
        let otherMonthClass = '';
        let isToday = false;
        
        if (i < startingDayOfWeek) {
            dayNumber = prevMonthLastDay - startingDayOfWeek + i + 1;
            otherMonthClass = 'other-month';
            const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
            const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;
            dateStr = `${prevYear}-${String(prevMonth + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
        } else if (dayCounter <= daysInMonth) {
            dayNumber = dayCounter;
            dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
            isToday = dateStr === todayStr;
            dayCounter++;
        } else {
            dayNumber = nextMonthDay;
            otherMonthClass = 'other-month';
            const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1;
            const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear;
            dateStr = `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(dayNumber).padStart(2, '0')}`;
            nextMonthDay++;
        }
        
        const dayShifts = shifts.filter(shift => {
            const shiftDate = new Date(shift.date);
            return formatDateYMD(shiftDate) === dateStr;
        });
        
        const hasShifts = dayShifts.length > 0;
        const todayClass = isToday ? 'today' : '';
        const hasShiftsClass = hasShifts ? 'has-shifts' : '';
        
        html += `
            <div class="calendar-day ${otherMonthClass} ${todayClass} ${hasShiftsClass}">
                <div class="day-number">${dayNumber}</div>
                <div class="day-shifts">
                    ${dayShifts.slice(0, 10).map(shift => {
                        const startTime = formatTimeOnly(shift.startTime);
                        const endTime = formatTimeOnly(shift.endTime);
                        return `
                        <div class="shift-item-mini ${getShiftClass(shift.shiftType)}" 
                             onclick="showShiftDetail('${shift.shiftId}')"
                             title="${shift.employeeName} - ${shift.shiftType} (${startTime}-${endTime})">
                            <div class="shift-item-name">${shift.employeeName}</div>
                            <div class="shift-item-time">${startTime}-${endTime}</div>
                        </div>
                    `}).join('')}
                </div>
                ${dayShifts.length > 3 ? `<div class="shift-count">+${dayShifts.length - 3}</div>` : ''}
            </div>
        `;
    }
    
    calendarGrid.innerHTML = html;
}

// 更新 getShiftClass 函數
function getShiftClass(shiftType) {
    const classMap = {
        // 廚房班別
        '廚房A班': 'shift-kitchen-a',
        '廚房B班': 'shift-kitchen-b',
        '廚房C班': 'shift-kitchen-c',
        '廚房D班': 'shift-kitchen-d',
        '廚房E班': 'shift-kitchen-e',
        '廚房F班': 'shift-kitchen-f',
        '廚房G班': 'shift-kitchen-g',
        '廚房H班': 'shift-kitchen-h',
        '廚房I班': 'shift-kitchen-i',
        
        // 外場班別
        '外場A1班': 'shift-floor-a1',
        '外場A2班': 'shift-floor-a2',
        '外場A3班': 'shift-floor-a3',
        '外場A4班': 'shift-floor-a4',
        '外場B1班': 'shift-floor-b1',
        '外場B2班': 'shift-floor-b2',
        '外場B3班': 'shift-floor-b3',
        '外場B4班': 'shift-floor-b4',
        
        // 假別
        '年假': 'shift-annual-leave',
        '過年假': 'shift-cny-leave',
        '國定假日': 'shift-national-holiday',
        '排休': 'shift-dayoff',
        '自訂': 'shift-custom'
    };
    return classMap[shiftType] || 'shift-custom';
}
function showShiftDetail(shiftId) {
    const shift = allMonthShifts.find(s => s.shiftId === shiftId);
    if (shift) {
        const startTime = formatTimeOnly(shift.startTime);
        const endTime = formatTimeOnly(shift.endTime);
        
        const detail = t('SHIFT_DETAIL_TITLE') + ':\n\n' +
              t('SHIFT_EMPLOYEE_LABEL') + ': ' + shift.employeeName + '\n' +
              t('SHIFT_DATE_LABEL') + ': ' + shift.date + '\n' +
              t('SHIFT_TYPE_LABEL') + ': ' + shift.shiftType + '\n' +
              t('SHIFT_TIME_LABEL') + ': ' + startTime + ' - ' + endTime + '\n' +
              t('SHIFT_LOCATION_LABEL') + ': ' + shift.location + '\n' +
              t('SHIFT_NOTE_LABEL') + ': ' + (shift.note || t('SHIFT_NO_NOTE'));
        
        alert(detail);
    }
}
async function loadShiftDistribution() {
    const distributionContainer = document.getElementById('shift-distribution');
    if (!distributionContainer) return;
    
    displayShiftDistribution(allMonthShifts);
}

function displayShiftDistribution(shifts) {
    const distributionContainer = document.getElementById('shift-distribution');
    if (!distributionContainer || shifts.length === 0) {
        if (distributionContainer) distributionContainer.innerHTML = '';
        return;
    }
    
    const employeeStats = {};
    const shiftTypeStats = { 
        '早班': 0, 
        '中班': 0, 
        '晚班': 0, 
        '全日班': 0,
        '排休': 0,
        '自訂': 0
    };
    
    shifts.forEach(shift => {
        if (!employeeStats[shift.employeeName]) {
            employeeStats[shift.employeeName] = 0;
        }
        employeeStats[shift.employeeName]++;
        
        if (shiftTypeStats[shift.shiftType] !== undefined) {
            shiftTypeStats[shift.shiftType]++;
        }
    });
    
    const maxCount = Math.max(...Object.values(employeeStats), 1);
    
    let html = '<div class="distribution-section">';
    html += '<h3 class="distribution-title"> 本月員工排班分布</h3>';
    html += '<div class="distribution-bars">';
    
    const sortedEmployees = Object.entries(employeeStats)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15);
    
    sortedEmployees.forEach(([name, count]) => {
        const percentage = (count / maxCount * 100).toFixed(0);
        html += `
            <div class="distribution-bar-item">
                <div class="distribution-bar-label">${name}</div>
                <div class="distribution-bar-container">
                    <div class="distribution-bar" style="width: ${percentage}%">
                        <div class="distribution-bar-value">${count} 班</div>
                    </div>
                </div>
            </div>
        `;
    });
    
    html += '</div></div>';
    
    html += '<div class="distribution-section">';
    html += '<h3 class="distribution-title"> 本月班別分布</h3>';
    html += '<div class="shift-type-distribution">';
    
    const totalShifts = Object.values(shiftTypeStats).reduce((a, b) => a + b, 0);
    const shiftTypeColors = {
        '早班': '#ff9800',
        '中班': '#2196f3',
        '晚班': '#9c27b0',
        '全日班': '#4caf50',
        '排休': '#9e9e9e',
        '自訂': '#fbc02d'
    };
    
    Object.entries(shiftTypeStats).forEach(([type, count]) => {
        const percentage = totalShifts > 0 ? (count / totalShifts * 100).toFixed(1) : 0;
        const color = shiftTypeColors[type];
        
        html += `
            <div class="shift-type-stat">
                <div class="shift-type-stat-header">
                    <span class="shift-type-label ${getShiftClass(type)}">${type}</span>
                    <span class="shift-type-count">${count}</span>
                </div>
                <div class="shift-type-bar-container">
                    <div class="shift-type-bar" style="width: ${percentage}%; background: ${color};"></div>
                </div>
                <div class="shift-type-percentage">${percentage}%</div>
            </div>
        `;
    });
    
    html += '</div></div>';
    
    distributionContainer.innerHTML = html;
}

function formatDateYMD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * 格式化時間為 HH:MM 格式
 * 支援多種輸入格式:
 * - "08:00" → "08:00"
 * - "1899-12-30T01:00:00.000Z" → "09:00" (UTC+8)
 * - Date 物件 → "HH:MM"
 */
function formatTimeOnly(timeValue) {
    //  修正：改用 == null 而非 !timeValue，避免 0 被當成 false
    if (timeValue == null || timeValue === '') return '00:00';
    
    // 已經是 HH:MM 格式
    if (typeof timeValue === 'string' && /^\d{2}:\d{2}$/.test(timeValue)) {
        return timeValue;
    }
    
    //  新增：處理 "0:00" 或 "0" 這種格式
    if (typeof timeValue === 'string' && /^\d{1}:\d{2}$/.test(timeValue)) {
        return '0' + timeValue; // "0:00" → "00:00"
    }
    
    // ISO 格式字串
    if (typeof timeValue === 'string' && timeValue.includes('T')) {
        try {
            const date = new Date(timeValue);
            const hours = String(date.getUTCHours() + 8).padStart(2, '0');
            const minutes = String(date.getUTCMinutes()).padStart(2, '0');
            return `${hours}:${minutes}`;
        } catch (e) {
            return '00:00';
        }
    }
    
    // Date 物件
    if (timeValue instanceof Date) {
        const hours = String(timeValue.getHours()).padStart(2, '0');
        const minutes = String(timeValue.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }
    
    return String(timeValue);
}

// ========== 工具函數 ==========

function showMessage(message, type = 'info') {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'success' ? '#4caf50' : type === 'error' ? '#f44336' : '#2196f3'};
        color: white;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => {
            if (messageDiv.parentNode) {
                document.body.removeChild(messageDiv);
            }
        }, 300);
    }, 3000);
}

function goBack() {
    window.history.back();
}

console.log(' 排班管理系統(含月曆功能)已載入');