// Excel 報表匯出：全員月報表、單月出勤報表、員工打卡明細
// 從 script.js 拆出。SheetJS 由 libs.js 的 ensureLib('xlsx') 延遲載入。

/**
 * 管理員匯出所有員工的出勤報表
 * @param {string} monthKey - 月份，格式: "YYYY-MM"
 */
async function exportAllEmployeesReport(monthKey) {
    await ensureLib('xlsx'); // 匯出時才載入 SheetJS
    const exportBtn = document.getElementById('admin-export-all-btn');
    const loadingText = t('EXPORT_LOADING') || '正在準備報表...';
    
    showNotification(loadingText, 'warning');
    
    if (exportBtn) {
        generalButtonState(exportBtn, 'processing', loadingText);
    }
    
    try {
        // 呼叫 API 取得所有員工的出勤資料（不傳 userId）
        const res = await callApifetch(`getAttendanceDetails&month=${monthKey}`);
        
        if (!res.ok || !res.records || res.records.length === 0) {
            showNotification(t('EXPORT_NO_DATA') || '本月沒有出勤記錄', 'warning');
            return;
        }
        
        //  修正：先檢查資料結構
        console.log('API 回傳的資料:', res.records[0]); // 除錯用
        
        // 按員工分組
        const employeeData = {};
        
        res.records.forEach(record => {
            //  修正：確保正確讀取 userId 和 name
            const userId = record.userId || 'unknown';
            const userName = record.name || '未知員工';
            
            if (!employeeData[userId]) {
                employeeData[userId] = {
                    name: userName,
                    records: []
                };
            }
            
            // 找出上班和下班的記錄
            const punchIn = record.record ? record.record.find(r => r.type === '上班') : null;
            const punchOut = record.record ? record.record.find(r => r.type === '下班') : null;
            
            // 計算工時
            let workHours = '-';
            if (punchIn && punchOut) {
                try {
                    const inTime = new Date(`${record.date} ${punchIn.time}`);
                    const outTime = new Date(`${record.date} ${punchOut.time}`);
                    const diffMs = outTime - inTime;
                    const diffHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
                    workHours = diffHours > 0 ? diffHours : '-';
                } catch (e) {
                    console.error('計算工時失敗:', e);
                    workHours = '-';
                }
            }
            
            const statusText = t(record.reason) || record.reason;
            
            const notes = record.record
                ? record.record
                    .filter(r => r.note && r.note !== '系統虛擬卡')
                    .map(r => r.note)
                    .join('; ')
                : '';
            
            employeeData[userId].records.push({
                '日期': record.date,
                '上班時間': punchIn?.time || '-',
                '上班地點': punchIn?.location || '-',
                '下班時間': punchOut?.time || '-',
                '下班地點': punchOut?.location || '-',
                '工作時數': workHours,
                '狀態': statusText,
                '備註': notes || '-'
            });
        });
        
        // 建立工作簿
        const wb = XLSX.utils.book_new();
        
        // 為每位員工建立一個工作表
        for (const userId in employeeData) {
            const employee = employeeData[userId];
            const ws = XLSX.utils.json_to_sheet(employee.records);
            
            const wscols = [
                { wch: 12 },  // 日期
                { wch: 10 },  // 上班時間
                { wch: 20 },  // 上班地點
                { wch: 10 },  // 下班時間
                { wch: 20 },  // 下班地點
                { wch: 10 },  // 工作時數
                { wch: 15 },  // 狀態
                { wch: 30 }   // 備註
            ];
            ws['!cols'] = wscols;
            
            const sheetName = employee.name.substring(0, 31);
            XLSX.utils.book_append_sheet(wb, ws, sheetName);
        }
        
        const [year, month] = monthKey.split('-');
        const fileName = `所有員工出勤記錄_${year}年${month}月.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        showNotification(t('EXPORT_SUCCESS') || '報表已成功匯出！', 'success');
        
    } catch (error) {
        console.error('匯出失敗:', error);
        showNotification(t('EXPORT_FAILED') || '匯出失敗，請稍後再試', 'error');
        
    } finally {
        if (exportBtn) {
            generalButtonState(exportBtn, 'idle');
        }
    }
}

// ====================  管理員匯出功能結束 ====================

// ====================  匯出出勤報表功能 ====================

/**
 * 匯出指定月份的出勤報表為 Excel 檔案
 * @param {Date} date - 要匯出的月份日期物件
 */
async function exportAttendanceReport(date) {
    await ensureLib('xlsx'); // 匯出時才載入 SheetJS
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    const userId = localStorage.getItem("sessionUserId");
    
    // 取得匯出按鈕
    const exportBtn = document.getElementById('export-attendance-btn');
    const loadingText = t('EXPORT_LOADING') || '正在準備報表...';
    
    // 顯示載入提示
    showNotification(loadingText, 'warning');
    
    // 按鈕進入處理中狀態
    if (exportBtn) {
        generalButtonState(exportBtn, 'processing', loadingText);
    }
    
    try {
        // 呼叫 API 取得出勤資料
        const res = await callApifetch(`getAttendanceDetails&month=${monthKey}&userId=${userId}`);
        
        if (!res.ok || !res.records || res.records.length === 0) {
            showNotification(t('EXPORT_NO_DATA') || '本月沒有出勤記錄', 'warning');
            return;
        }
        
        // 整理資料為 Excel 格式
        const exportData = [];
        
        res.records.forEach(record => {
            // 找出上班和下班的記錄
            const punchIn = record.record.find(r => r.type === '上班');
            const punchOut = record.record.find(r => r.type === '下班');
            
            // 計算工時
            let workHours = '-';
            if (punchIn && punchOut) {
                try {
                    const inTime = new Date(`${record.date} ${punchIn.time}`);
                    const outTime = new Date(`${record.date} ${punchOut.time}`);
                    const diffMs = outTime - inTime;
                    const diffHours = (diffMs / (1000 * 60 * 60)).toFixed(2);
                    workHours = diffHours > 0 ? diffHours : '-';
                } catch (e) {
                    console.error('計算工時失敗:', e);
                    workHours = '-';
                }
            }
            
            // 翻譯狀態
            const statusText = t(record.reason) || record.reason;
            
            // 處理備註
            const notes = record.record
                .filter(r => r.note && r.note !== '系統虛擬卡')
                .map(r => r.note)
                .join('; ');
            
            exportData.push({
                '日期': record.date,
                '上班時間': punchIn?.time || '-',
                '上班地點': punchIn?.location || '-',
                '下班時間': punchOut?.time || '-',
                '下班地點': punchOut?.location || '-',
                '工作時數': workHours,
                '狀態': statusText,
                '備註': notes || '-'
            });
        });
        
        // 使用 SheetJS 建立 Excel 檔案
        const ws = XLSX.utils.json_to_sheet(exportData);
        
        // 設定欄位寬度
        const wscols = [
            { wch: 12 },  // 日期
            { wch: 10 },  // 上班時間
            { wch: 20 },  // 上班地點
            { wch: 10 },  // 下班時間
            { wch: 20 },  // 下班地點
            { wch: 10 },  // 工作時數
            { wch: 15 },  // 狀態
            { wch: 30 }   // 備註
        ];
        ws['!cols'] = wscols;
        
        // 建立工作簿
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `${month}月出勤記錄`);
        
        // 下載檔案
        const fileName = `出勤記錄_${year}年${month}月.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        showNotification(t('EXPORT_SUCCESS') || '報表已成功匯出！', 'success');
        
    } catch (error) {
        console.error('匯出失敗:', error);
        showNotification(t('EXPORT_FAILED') || '匯出失敗，請稍後再試', 'error');
        
    } finally {
        // 恢復按鈕狀態
        if (exportBtn) {
            generalButtonState(exportBtn, 'idle');
        }
    }
}

// ====================  匯出功能結束 ====================

/**
 * 匯出員工打卡報表（含時分秒和每日總時數）
 */
async function exportEmployeePunchReport() {
    await ensureLib('xlsx'); // 匯出時才載入 SheetJS
    const employeeSelect = document.getElementById('analysis-employee');
    const monthInput = document.getElementById('analysis-month');
    const exportBtn = document.getElementById('export-employee-punch-btn');
    
    if (!employeeSelect || !monthInput) return;
    
    const employeeId = employeeSelect.value;
    const yearMonth = monthInput.value;
    
    if (!employeeId) {
        showNotification(t('NOTIF_SELECT_EMPLOYEE'), 'error');
        return;
    }
    
    if (!yearMonth) {
        showNotification(t('NOTIF_SELECT_MONTH'), 'error');
        return;
    }
    
    const loadingText = t('EXPORT_LOADING') || '正在準備報表...';
    showNotification(loadingText, 'warning');
    
    if (exportBtn) {
        generalButtonState(exportBtn, 'processing', loadingText);
    }
    
    try {
        // 取得員工名稱
        const employeeName = employeeSelect.options[employeeSelect.selectedIndex].text.split(' (')[0];
        
        // 呼叫後端 API 取得詳細打卡資料
        const res = await callApifetch(`getAttendanceDetails&month=${yearMonth}&userId=${employeeId}`);
        
        if (!res.ok || !res.records || res.records.length === 0) {
            showNotification(t('EXPORT_NO_DATA') || '本月沒有出勤記錄', 'warning');
            return;
        }
        
        // 整理資料為 Excel 格式
        const exportData = [];
        
        res.records.forEach(record => {
            // 找出上班和下班的記錄
            const punchInRecord = record.record ? record.record.find(r => r.type === '上班') : null;
            const punchOutRecord = record.record ? record.record.find(r => r.type === '下班') : null;
            
            // 計算工時
            let workHours = '-';
            let workHoursDecimal = 0;
            let overtimeHours = 0;
            let hasOvertime = false;

            if (punchInRecord && punchOutRecord) {
                try {
                    // 使用完整的日期時間來計算
                    const inTime = new Date(`${record.date} ${punchInRecord.time}`);
                    const outTime = new Date(`${record.date} ${punchOutRecord.time}`);
                    const diffMs = outTime - inTime;
                    
                    if (diffMs > 0) {
                        // 計算總工時（小時）
                        const totalHours = diffMs / (1000 * 60 * 60);
                        
                        // 扣除午休 1 小時
                        const lunchBreak = 1;
                        const netWorkHours = totalHours - lunchBreak;
                        
                        // 計算加班時數（超過標準工時 8 小時的部分）
                        const standardWorkHours = 8;
                        overtimeHours = Math.max(0, netWorkHours - standardWorkHours);
                        
                        // 格式化顯示
                        workHoursDecimal = netWorkHours;
                        const hours = Math.floor(netWorkHours);
                        const minutes = Math.round((netWorkHours - hours) * 60);
                        workHours = `${hours}小時${minutes}分`;
                        
                        // 標記是否有加班
                        hasOvertime = overtimeHours > 0.5; // 超過 30 分鐘才算加班
                        
                        console.log(`工時計算:`, {
                            date: record.date,
                            總時長: totalHours.toFixed(2),
                            扣除午休: lunchBreak,
                            淨工時: netWorkHours.toFixed(2),
                            加班時數: overtimeHours.toFixed(2)
                        });
                    }
                } catch (e) {
                    console.error('計算工時失敗:', e);
                    workHours = '計算錯誤';
                }
            }
                        
            // 翻譯狀態
            const statusText = t(record.reason) || record.reason;
            
            // 處理備註
            const notes = record.record
                ? record.record
                    .filter(r => r.note && r.note !== '系統虛擬卡')
                    .map(r => r.note)
                    .join('; ')
                : '';
            
            exportData.push({
                '日期': record.date,
                '星期': getDayOfWeek(record.date),
                '上班時間': punchInRecord ? `${punchInRecord.time}:00` : '-',
                '上班地點': punchInRecord?.location || '-',
                '下班時間': punchOutRecord ? `${punchOutRecord.time}:00` : '-',
                '下班地點': punchOutRecord?.location || '-',
                '工作時數': workHours,
                '工時（小時）': workHoursDecimal > 0 ? workHoursDecimal.toFixed(2) : '-',
                '狀態': statusText,
                '備註': notes || '-'
            });
        });
        
        // 計算統計資料
        const totalWorkHours = exportData.reduce((sum, row) => {
            const hours = parseFloat(row['工時（小時）']);
            return sum + (isNaN(hours) ? 0 : hours);
        }, 0);
        
        const totalDays = exportData.filter(row => row['工時（小時）'] !== '-').length;
        const avgWorkHours = totalDays > 0 ? (totalWorkHours / totalDays).toFixed(2) : 0;
        
        // 新增統計行
        exportData.push({});
        exportData.push({
            '日期': '統計',
            '星期': '',
            '上班時間': '',
            '上班地點': '',
            '下班時間': '',
            '下班地點': '',
            '工作時數': `共 ${totalDays} 天`,
            '工時（小時）': totalWorkHours.toFixed(2),
            '狀態': `平均: ${avgWorkHours}`,
            '備註': ''
        });
        
        // 使用 SheetJS 建立 Excel 檔案
        const ws = XLSX.utils.json_to_sheet(exportData);
        
        // 設定欄位寬度
        const wscols = [
            { wch: 12 },  // 日期
            { wch: 8 },   // 星期
            { wch: 12 },  // 上班時間
            { wch: 25 },  // 上班地點
            { wch: 12 },  // 下班時間
            { wch: 25 },  // 下班地點
            { wch: 15 },  // 工作時數
            { wch: 12 },  // 工時（小時）
            { wch: 18 },  // 狀態
            { wch: 30 }   // 備註
        ];
        ws['!cols'] = wscols;
        
        // 建立工作簿
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, `${yearMonth.split('-')[1]}月出勤`);
        
        // 下載檔案
        const [year, month] = yearMonth.split('-');
        const fileName = `${employeeName}_${year}年${month}月_打卡記錄.xlsx`;
        XLSX.writeFile(wb, fileName);
        
        showNotification(t('EXPORT_SUCCESS') || '報表已成功匯出！', 'success');
        
    } catch (error) {
        console.error('匯出失敗:', error);
        showNotification(t('EXPORT_FAILED') || '匯出失敗，請稍後再試', 'error');
        
    } finally {
        if (exportBtn) {
            generalButtonState(exportBtn, 'idle');
        }
    }
}
