// Main.gs - 完整版（含打卡、加班、請假、排班系統）

// doGet(e) 負責處理所有外部請求
function doGet(e) {
  const action       = e.parameter.action;
  const callback     = e.parameter.callback || "callback";
  const sessionToken = e.parameter.token;
  const code         = e.parameter.otoken;

  function respond(obj) {
    return ContentService.createTextOutput(
      `${callback}(${JSON.stringify(obj)})`
    ).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  
  function respond1(obj) {
    const output = ContentService.createTextOutput(JSON.stringify(obj));
    output.setMimeType(ContentService.MimeType.JSON);
    return output;
  }
  
  try {
    switch (action) {
      // ==================== 登入與 Session ====================
      case "getProfile":
        return respond1(handleGetProfile(code));
      case "getLoginUrl":
        return respond1(handleGetLoginUrl());
      case "checkSession":
        return respond1(handleCheckSession(sessionToken));
      case "exchangeToken":
        return respond1(handleExchangeToken(e.parameter.otoken));
      
      // ==================== 打卡系統 ====================
      case "punch":
        return respond1(handlePunch(e.parameter));
      case "linePunch":
        return respond1(handleLinePunchWithToken(e.parameter));
      case "adjustPunch":
        return respond1(handleAdjustPunch(e.parameter));
      case "getAbnormalRecords":
        return respond1(handleGetAbnormalRecords(e.parameter));
      case "getAttendanceDetails":
        return respond1(handleGetAttendanceDetails(e.parameter));
      
      // ==================== 地點管理 ====================
      case "addLocation":
        return respond1(handleAddLocation(e.parameter));
      case "getLocations":
        return respond1(handleGetLocation());
      
      case "setEmployeeBasicInfo":
        return respond1(handleSetEmployeeBasicInfo(e.parameter));

      case "getEmployeeBasicInfo":
        return respond1(handleGetEmployeeBasicInfo(e.parameter));

      case "getAllEmployeeBasicInfo":
        return respond1(handleGetAllEmployeeBasicInfo(e.parameter));

      case "deleteEmployeeBasicInfo":
        return respond1(handleDeleteEmployeeBasicInfo(e.parameter));
      // ==================== 員工管理 ====================
      case "getAllUsers":
        return respond1(handleGetAllUsers(e.parameter));
      
      case "updateUserRole":
        return respond1(handleUpdateUserRole(e.parameter));
      case "deleteUser":
        return respond1(handleDeleteUser(e.parameter));
      
      case "updateEmployeeName":
        if (!validateSession(e.parameter.token)) {
          return respond1({ ok: false, code: "ERR_SESSION_INVALID" });
        }
        
        const targetUserId = e.parameter.userId;
        const newName = e.parameter.newName;
        
        if (!targetUserId || !newName) {
          return respond1({ ok: false, msg: "缺少必要參數" });
        }
        
        const updateNameResult = updateEmployeeName(targetUserId, newName);
        return respond1(updateNameResult);
      // ==================== 補打卡審核 ====================
      case "getReviewRequest":
        return respond1(handleGetReviewRequest());
      case "approveReview":
        return respond1(handleApproveReview(e.parameter));
      case "rejectReview":
        return respond1(handleRejectReview(e.parameter));
      
      // ==================== 加班系統 ====================
      case "submitOvertime":
        return respond1(handleSubmitOvertime(e.parameter));
      case "getEmployeeOvertime":
        return respond1(handleGetEmployeeOvertime(e.parameter));
      case "getPendingOvertime":
        return respond1(handleGetPendingOvertime(e.parameter));
      case "reviewOvertime":
        return respond1(handleReviewOvertime(e.parameter));
      
      // ==================== 請假系統 ====================
      case "getLeaveBalance":
        return respond1(handleGetLeaveBalance(e.parameter));
      case "submitLeave":
        return respond1(handleSubmitLeave(e.parameter));
      case "getEmployeeLeaveRecords":
        return respond1(handleGetEmployeeLeaveRecords(e.parameter));
      case "getPendingLeaveRequests":
        return respond1(handleGetPendingLeaveRequests(e.parameter));
      case "reviewLeave":
        return respond1(handleReviewLeave(e.parameter));
      case "initializeEmployeeLeave":
        return respond1(handleInitializeEmployeeLeave(e.parameter));
      
      // ==================== 工作日誌系統（⭐ 新增在這裡）====================
      case "submitWorklog":
        return respond1(handleSubmitWorklog(e.parameter));
      case "getWorklogs":
        return respond1(handleGetWorklogs(e.parameter));
      case "getWorklogDetail":
        return respond1(handleGetWorklogDetail(e.parameter));
      case "getPendingWorklogs":
        return respond1(handleGetPendingWorklogs(e.parameter));
      case "reviewWorklog":
        return respond1(handleReviewWorklog(e.parameter));
      case "getWorklogReport":
        return respond1(handleGetWorklogReport(e.parameter));
      case "getAllWorklogReport":  
        return respond1(handleGetAllWorklogReport(e.parameter));
      // ==================== 排班系統 ====================
      case "addShift":
        return respond1(handleAddShift(e.parameter));
      case "batchAddShifts":
        return respond(handleBatchAddShifts(e.parameter));
      case "getShifts":
        return respond1(handleGetShifts(e.parameter));
      case "getShiftById":
        return respond1(handleGetShiftById(e.parameter));
      case "updateShift":
        return respond1(handleUpdateShift(e.parameter));
      case "deleteShift":
        return respond1(handleDeleteShift(e.parameter));
      case "getEmployeeShiftForDate":
        return respond1(handleGetEmployeeShiftForDate(e.parameter));
      case "getWeeklyShiftStats":
        return respond1(handleGetWeeklyShiftStats(e.parameter));
      case "exportShifts":
        return respond1(handleExportShifts(e.parameter));
      
      // ==================== 薪資系統 ====================
      case "setEmployeeSalaryTW":
        return respond1(handleSetEmployeeSalaryTW(e.parameter));
      case "getEmployeeSalaryTW":
        return respond1(handleGetEmployeeSalaryTW(e.parameter));
      case "getMySalary":
        return respond1(handleGetMySalary(e.parameter));
      case "getMySalaryHistory":
        return respond1(handleGetMySalaryHistory(e.parameter));
      case "calculateMonthlySalary":
        return respond1(handleCalculateMonthlySalary(e.parameter));
      case "getEmployeeWorkHours":
        return respond1(handleGetEmployeeWorkHours(e.parameter));
      // case "saveMonthlySalary":
      //   return respond1(handleSaveMonthlySalary(e.parameter));
      case "getAllMonthlySalary":
        return respond1(handleGetAllMonthlySalary(e.parameter));

      // ==================== 三節獎金系統 ====================
      case "setBonusRecord":
        return respond1(handleSetBonusRecord(e.parameter));
      case "getMyBonusRecords":
        return respond1(handleGetMyBonusRecords(e.parameter));
      case "getAllBonusRecords":
        return respond1(handleGetAllBonusRecords(e.parameter));

       // ==================== 日薪系統 ====================
      case "setDailyEmployee":
        return respond1(handleSetDailyEmployee(e.parameter));
      case "getDailyEmployee":
        return respond1(handleGetDailyEmployee(e.parameter));
      case "calculateDailySalary":
        return respond1(handleCalculateDailySalary(e.parameter));
      case "saveDailySalaryRecord":
        return respond1(handleSaveDailySalaryRecord(e.parameter));
      case "getAllDailyEmployees":
        return respond1(handleGetAllDailyEmployees(e.parameter));
      case "getDailySalaryRecords":
        return respond1(handleGetDailySalaryRecords(e.parameter));

      case "saveMonthlySalary":
        return saveMonthlySalaryAPI();

      case 'exportAllSalaryExcel':
        try {
          Logger.log(' 收到 exportAllSalaryExcel 请求');
          Logger.log('   action: ' + action);
          Logger.log('   token: ' + (e.parameter.token ? '有' : '无'));
          Logger.log('   yearMonth: ' + e.parameter.yearMonth);
          
          // ⭐ 验证 session
          if (!e.parameter.token) {
            Logger.log(' 缺少 token');
            return respond1({ 
              ok: false, 
              msg: '缺少 token',
              code: 'MISSING_TOKEN' 
            });
          }
          
          if (!validateSession(e.parameter.token)) {
            Logger.log(' token 验证失败');
            return respond1({ 
              ok: false, 
              msg: '未授權或 session 已過期',
              code: 'SESSION_INVALID' 
            });
          }
          
          Logger.log(' token 验证成功');
          
          const sessionResult = handleCheckSession(e.parameter.token);
          
          if (!sessionResult.ok || !sessionResult.user) {
            Logger.log(' 无法取得使用者资讯');
            return respond1({ 
              ok: false, 
              msg: 'Session 資料無效',
              code: 'SESSION_DATA_INVALID' 
            });
          }
          
          const user = sessionResult.user;
          Logger.log(' 使用者: ' + user.name);
          Logger.log(' 權限: ' + user.dept);
          
          if (user.dept !== '管理員') {
            Logger.log(' 权限不足');
            return respond1({ 
              ok: false, 
              msg: '此功能僅限管理員使用',
              code: 'PERMISSION_DENIED' 
            });
          }
          
          const yearMonth = e.parameter.yearMonth;
          if (!yearMonth) {
            Logger.log(' 缺少 yearMonth');
            return respond1({ 
              ok: false, 
              msg: '缺少年月參數',
              code: 'MISSING_YEAR_MONTH' 
            });
          }
          
          Logger.log(` 管理員 ${user.name} 請求匯出 ${yearMonth} 薪資總表`);
          
          // ⭐⭐⭐ 關鍵修正：設定 globalThis.currentRequest
          globalThis.currentRequest = e;
          
          // ⭐⭐⭐ 呼叫匯出函数（不傳參數）
          const result = exportAllSalaryExcel();
          
          Logger.log(' exportAllSalaryExcel 回传类型: ' + typeof result);
          
          // ⭐⭐⭐ 修正：result 是 ContentService 物件，需要解析
          try {
            const resultContent = result.getContent();
            const resultJson = JSON.parse(resultContent);
            
            Logger.log(' 解析後的結果: ' + JSON.stringify(resultJson));
            
            if (resultJson.ok) {
              return respond1({ 
                ok: true, 
                fileUrl: resultJson.data.fileUrl,
                fileName: resultJson.data.fileName,
                recordCount: resultJson.data.recordCount,
                msg: '匯出成功'
              });
            } else {
              return respond1({ 
                ok: false, 
                msg: resultJson.message || resultJson.msg || '匯出失敗'
              });
            }
          } catch (parseError) {
            Logger.log(' 解析結果失敗: ' + parseError);
            return respond1({ 
              ok: false, 
              msg: '結果解析失敗: ' + parseError.message 
            });
          }
          
        } catch (error) {
          Logger.log(' exportAllSalaryExcel 錯誤: ' + error);
          Logger.log(' 錯誤堆疊: ' + error.stack);
          return respond1({ 
            ok: false, 
            msg: '系統錯誤: ' + error.message 
          });
        }
        break;
      // 在 doGet(e) 的 switch 區塊中新增：
      case "getEmployeeMonthlyPunchData":
        return respond1(handleGetEmployeeMonthlyPunchData(e.parameter));
      
      // ==================== QR 打卡系統 ====================
      case "qrPunch":
        return respond1(handleQRPunch(e.parameter));

      case "getAnnouncements":
        return respond1(handleGetAnnouncements(e.parameter));
      case "addAnnouncement":
        return respond1(handleAddAnnouncement(e.parameter));
      case "deleteAnnouncement":
        return respond1(handleDeleteAnnouncement(e.parameter));
      
      // ==================== 費用管理系統 ====================
      case "submitAdvanceApplication":
        return respond1(handleSubmitAdvanceApplication(e.parameter));
      case "submitReimbursement":
        return respond1(handleSubmitReimbursement(e.parameter));
      case "getAdvanceRecords":
        return respond1(handleGetAdvanceRecords(e.parameter));
      case "getReimbursementRecords":
        return respond1(handleGetReimbursementRecords(e.parameter));
      case "reviewAdvanceApplication":
        return respond1(handleReviewAdvanceApplication(e.parameter));
      case "reviewReimbursement":
        return respond1(handleReviewReimbursement(e.parameter));
      // ==================== 假日清單 ====================
      case "getHolidays":
        return respond1(handleGetHolidays());
      
      // ==================== 測試端點 ====================
      case "initApp":
        return respond1(handleInitApp(e.parameter));
      case "testEndpoint":
        return respond1({ ok: true, msg: "CORS 測試成功!" });
      
      // ==================== 預設：返回 HTML 頁面 ====================
      default:
        return HtmlService.createHtmlOutputFromFile('index')
               .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
  } catch (err) {
    return respond1({ ok: false, msg: err.message });
  }
}

// Main.gs - 新增 LINE Bot Webhook 處理

function doPost(e) {
  try {
    Logger.log('═══════════════════════════════════════');
    Logger.log(' 收到 POST 請求');
    Logger.log('═══════════════════════════════════════');
    
    //  先嘗試從 parameter 讀取（FormData）
    if (e.parameter && e.parameter.action) {
      Logger.log(' 識別為 Form Data 請求');
      
      const action = e.parameter.action;
      const token = e.parameter.token;
      
      Logger.log('   action: ' + action);
      Logger.log('   token: ' + (token ? '有' : '無'));
      
      // ========== 處理批量上傳排班 ==========
      if (action === 'batchAddShifts') {
        Logger.log(' 處理批量上傳排班');
        
        // 驗證 token
        if (!token || !validateSession(token)) {
          Logger.log(' Token 驗證失敗');
          return ContentService.createTextOutput(JSON.stringify({
            ok: false,
            msg: '未授權或 session 已過期'
          })).setMimeType(ContentService.MimeType.JSON);
        }
        
        Logger.log(' Token 驗證成功');
        
        // 檢查權限
        const permCheck = checkSchedulingPermission(token);
        if (!permCheck.ok) {
          Logger.log(' 權限檢查失敗');
          return ContentService.createTextOutput(JSON.stringify(permCheck))
            .setMimeType(ContentService.MimeType.JSON);
        }
        
        Logger.log(' 權限驗證通過（by ' + permCheck.user.name + '）');
        
        //  從 Form Data 解析 shiftsArray
        let shiftsArray;
        try {
          shiftsArray = JSON.parse(e.parameter.shiftsArray);
          Logger.log(' 成功解析 shiftsArray: ' + shiftsArray.length + ' 筆');
        } catch (parseError) {
          Logger.log(' 解析 shiftsArray 失敗: ' + parseError);
          return ContentService.createTextOutput(JSON.stringify({
            ok: false,
            msg: '資料格式錯誤'
          })).setMimeType(ContentService.MimeType.JSON);
        }
        
        if (!Array.isArray(shiftsArray)) {
          Logger.log(' shiftsArray 不是陣列');
          return ContentService.createTextOutput(JSON.stringify({
            ok: false,
            msg: 'shiftsArray 必須是陣列'
          })).setMimeType(ContentService.MimeType.JSON);
        }
        
        if (shiftsArray.length === 0) {
          Logger.log(' shiftsArray 是空的');
          return ContentService.createTextOutput(JSON.stringify({
            ok: false,
            msg: '批量資料不能為空'
          })).setMimeType(ContentService.MimeType.JSON);
        }
        
        Logger.log(' 準備批量新增: ' + shiftsArray.length + ' 筆排班');
        
        // 呼叫核心函數
        const result = batchAddShifts(shiftsArray);
        
        Logger.log('');
        Logger.log(' 批量新增結果:');
        Logger.log('   成功: ' + result.results.success + ' 筆');
        Logger.log('   失敗: ' + result.results.failed + ' 筆');
        Logger.log('═══════════════════════════════════════');
        
        return ContentService.createTextOutput(JSON.stringify({
          ok: result.success,
          msg: result.message,
          results: result.results
        })).setMimeType(ContentService.MimeType.JSON);
      }
      
      //  其他 action 一律交給 doGet 的路由處理
      //  POST 表單的參數同樣落在 e.parameter，所以路由可以完全共用。
      //  這讓前端能改用 POST 傳 token，不必再把權杖放在網址列（會留在瀏覽器歷史與存取紀錄裡）。
      Logger.log(' 交由 doGet 路由處理: ' + action);
      return doGet(e);
    }
    
    //  如果不是 Form Data，嘗試解析 JSON（LINE Webhook）
    if (e.postData && e.postData.contents) {
      Logger.log(' postData.contents: ' + e.postData.contents.substring(0, 200) + '...');
      
      const postData = JSON.parse(e.postData.contents);
      
      // LINE Webhook（有 events 屬性）
      if (postData.events && Array.isArray(postData.events)) {
        Logger.log(' 識別為 LINE Webhook 請求');
        Logger.log(' 收到 ' + postData.events.length + ' 個事件');
        
        // 處理每個事件
        postData.events.forEach((event, index) => {
          Logger.log('');
          Logger.log(` 處理事件 ${index + 1}/${postData.events.length}`);
          Logger.log('   type: ' + event.type);
          
          const eventId = event.webhookEventId || 
                         `${event.timestamp}_${event.source.userId}_${event.type}`;
          
          Logger.log('   eventId: ' + eventId);
          
          if (isEventProcessed_(eventId)) {
            Logger.log('⏭ 跳過已處理的事件');
            return;
          }
          
          try {
            if (event.type === 'message') {
              if (event.message.type === 'text') {
                Logger.log('   message.type: text');
                Logger.log('   message.text: ' + event.message.text);
                handleLineMessage(event);
              } else if (event.message.type === 'location') {
                Logger.log('   message.type: location');
                Logger.log('   latitude: ' + event.message.latitude);
                Logger.log('   longitude: ' + event.message.longitude);
                handleLineLocation(event);
              }
            }
          } catch (eventError) {
            Logger.log(' 事件處理錯誤: ' + eventError);
            Logger.log('   錯誤堆疊: ' + eventError.stack);
          }
        });
        
        Logger.log('');
        Logger.log(' LINE Webhook 處理完成');
        Logger.log('═══════════════════════════════════════');
        
        return ContentService.createTextOutput(JSON.stringify({
          status: 'ok'
        })).setMimeType(ContentService.MimeType.JSON);
      }
    }
    
    // 未知的請求類型
    Logger.log(' 無法識別的請求類型');
    Logger.log('═══════════════════════════════════════');
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: '無法識別的請求類型'
    })).setMimeType(ContentService.MimeType.JSON);
    
  } catch (error) {
    Logger.log('');
    Logger.log(' doPost 錯誤: ' + error);
    Logger.log('   錯誤訊息: ' + error.message);
    Logger.log('   錯誤堆疊: ' + error.stack);
    Logger.log('═══════════════════════════════════════');
    
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      message: error.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function isEventProcessed_(eventId) {
  const cache = CacheService.getScriptCache();
  const key = 'event_' + eventId;
  
  const cached = cache.get(key);
  if (cached) {
    return true;
  }
  
  cache.put(key, 'processed', 3600);
  return false;
}
/**
 *  檢查事件是否已處理（去重機制）
 */
function isEventProcessed_(eventId) {
  const cache = CacheService.getScriptCache();
  const key = 'event_' + eventId;
  
  // 檢查快取中是否有這個事件
  const cached = cache.get(key);
  if (cached) {
    return true;  // 已處理過
  }
  
  // 標記為已處理（有效期 1 小時）
  cache.put(key, 'processed', 3600);
  return false;  // 第一次處理
}


/**
 * 驗證 LINE Signature（測試模式：暫時停用）
 */
/**
 *  Signature 驗證（測試模式：已停用）
 * 
 * 正式上線時請啟用此函數
 */
function verifyLineSignature_(body, signature) {
  // 測試期間暫時返回 true
  Logger.log(' Signature 驗證已暫時停用（測試模式）');
  return true;
  
  /* 
  //  正式上線時請啟用以下程式碼：
  try {
    const channelSecret = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET');
    
    if (!channelSecret) {
      Logger.log(' 找不到 LINE_CHANNEL_SECRET');
      return false;
    }
    
    const hash = Utilities.computeHmacSha256Signature(body, channelSecret);
    const expectedSignature = Utilities.base64Encode(hash);
    
    Logger.log(' Expected Signature: ' + expectedSignature);
    Logger.log(' Received Signature: ' + signature);
    
    return expectedSignature === signature;
    
  } catch (error) {
    Logger.log(' Signature 驗證錯誤: ' + error);
    return false;
  }
  */
}
// function verifyLineSignature_(body, signature) {
//   //  測試期間暫時返回 true
//   Logger.log(' Signature 驗證已暫時停用（測試模式）');
//   return true;

//   /* 
//   //  正式上線時請啟用以下程式碼：
//   try {
//     const channelSecret = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET');
    
//     if (!channelSecret) {
//       Logger.log(' 找不到 LINE_CHANNEL_SECRET');
//       return false;
//     }
    
//     const hash = Utilities.computeHmacSha256Signature(body, channelSecret);
//     const expectedSignature = Utilities.base64Encode(hash);
    
//     Logger.log(' Expected Signature: ' + expectedSignature);
//     Logger.log(' Received Signature: ' + signature);
    
//     return expectedSignature === signature;
    
//   } catch (error) {
//     Logger.log(' Signature 驗證錯誤: ' + error);
//     return false;
//   }
//   */
// }

// function verifyLineSignature_(body, signature) {
//   const channelSecret = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_SECRET');
//   const hash = Utilities.computeHmacSha256Signature(body, channelSecret);
//   const expectedSignature = Utilities.base64Encode(hash);
//   return expectedSignature === signature;
// }

// ==================== 排班系統 Handler 函數 ====================

// ==================== 排班系統 Handler 函數（修正版）====================

/**
 * 處理新增排班（⭐ 支援排班人員權限）
 */
function handleAddShift(params) {
  try {
    // ⭐ 修正：使用排班權限檢查
    const permCheck = checkSchedulingPermission(params.token);
    if (!permCheck.ok) {
      return permCheck;  // 返回權限錯誤
    }
    
    Logger.log(' 收到新增排班請求（by ' + permCheck.user.name + '）');
    
    const shiftData = {
      employeeId: params.employeeId,
      employeeName: params.employeeName,
      date: params.date,
      shiftType: params.shiftType,
      startTime: params.startTime,
      endTime: params.endTime,
      location: params.location,
      note: params.note
    };
    
    if (!shiftData.employeeId || !shiftData.date || !shiftData.shiftType) {
      return { ok: false, msg: "缺少必填欄位" };
    }
    
    const result = addShift(shiftData);
    return { 
      ok: result.success, 
      data: result, 
      msg: result.message 
    };
    
  } catch (error) {
    Logger.log(' handleAddShift 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 處理批量新增排班（⭐ 支援排班人員權限）
 */
function handleBatchAddShifts(params) {
  try {
    // ⭐ 修正：使用排班權限檢查
    const permCheck = checkSchedulingPermission(params.token);
    if (!permCheck.ok) {
      return permCheck;
    }
    
    Logger.log(' 收到批量新增排班請求（by ' + permCheck.user.name + '）');
    
    //  從 URL 參數取得資料
    let shiftsArray;
    
    if (params.shiftsArray) {
      try {
        if (typeof params.shiftsArray === 'string') {
          const decoded = decodeURIComponent(params.shiftsArray);
          shiftsArray = JSON.parse(decoded);
          Logger.log(' 成功解析 shiftsArray: ' + shiftsArray.length + ' 筆');
        } else {
          shiftsArray = params.shiftsArray;
        }
      } catch (parseError) {
        Logger.log(' 解析失敗: ' + parseError);
        return { ok: false, msg: "資料格式錯誤: 無法解析 JSON" };
      }
    } else {
      Logger.log(' 缺少 shiftsArray 參數');
      return { ok: false, msg: "缺少 shiftsArray 參數" };
    }
    
    if (!Array.isArray(shiftsArray)) {
      return { ok: false, msg: "shiftsArray 必須是陣列" };
    }
    
    if (shiftsArray.length === 0) {
      return { ok: false, msg: "批量資料不能為空" };
    }
    
    Logger.log(' 準備批量新增: ' + shiftsArray.length + ' 筆排班');
    
    const result = batchAddShifts(shiftsArray);
    
    Logger.log(' 批量新增結果: ' + JSON.stringify(result));
    
    return { 
      ok: result.success, 
      msg: result.message,
      data: result
    };
    
  } catch (error) {
    Logger.log(' handleBatchAddShifts 錯誤: ' + error);
    return { ok: false, msg: "批量新增失敗: " + error.message };
  }
}

/**
 * 處理查詢排班（所有人都可以查看）
 */
function handleGetShifts(params) {
  try {
    // ⭐ 查詢排班：只需要基本的 session 驗證
    if (!params.token || !validateSession(params.token)) {
      return { ok: false, msg: "未授權或 session 已過期" };
    }
    
    Logger.log(' 收到查詢排班請求');
    
    const filters = {
      employeeId: params.employeeId,
      startDate: params.startDate,
      endDate: params.endDate,
      shiftType: params.shiftType,
      location: params.location
    };
    
    const result = getShifts(filters);
    return { 
      ok: result.success, 
      data: result.data, 
      count: result.count, 
      msg: result.message 
    };
    
  } catch (error) {
    Logger.log(' handleGetShifts 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 處理取得單一排班詳情（所有人都可以查看）
 */
function handleGetShiftById(params) {
  try {
    if (!params.token || !validateSession(params.token)) {
      return { ok: false, msg: "未授權或 session 已過期" };
    }
    
    if (!params.shiftId) {
      return { ok: false, msg: "缺少 shiftId 參數" };
    }
    
    Logger.log(' 查詢排班詳情: ' + params.shiftId);
    
    const result = getShiftById(params.shiftId);
    return { 
      ok: result.success, 
      data: result.data, 
      msg: result.message 
    };
    
  } catch (error) {
    Logger.log(' handleGetShiftById 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 處理更新排班（⭐ 支援排班人員權限）
 */
function handleUpdateShift(params) {
  try {
    // ⭐ 修正：使用排班權限檢查
    const permCheck = checkSchedulingPermission(params.token);
    if (!permCheck.ok) {
      return permCheck;
    }
    
    if (!params.shiftId) {
      return { ok: false, msg: "缺少 shiftId 參數" };
    }
    
    Logger.log(' 更新排班: ' + params.shiftId + '（by ' + permCheck.user.name + '）');
    
    const updateData = {
      date: params.date,
      shiftType: params.shiftType,
      startTime: params.startTime,
      endTime: params.endTime,
      location: params.location,
      note: params.note
    };
    
    const result = updateShift(params.shiftId, updateData);
    return { 
      ok: result.success, 
      msg: result.message 
    };
    
  } catch (error) {
    Logger.log(' handleUpdateShift 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 處理刪除排班（⭐ 支援排班人員權限）
 */
function handleDeleteShift(params) {
  try {
    // ⭐ 修正：使用排班權限檢查
    const permCheck = checkSchedulingPermission(params.token);
    if (!permCheck.ok) {
      return permCheck;
    }
    
    if (!params.shiftId) {
      return { ok: false, msg: "缺少 shiftId 參數" };
    }
    
    Logger.log(' 刪除排班: ' + params.shiftId + '（by ' + permCheck.user.name + '）');
    
    const result = deleteShift(params.shiftId);
    return { 
      ok: result.success, 
      msg: result.message 
    };
    
  } catch (error) {
    Logger.log(' handleDeleteShift 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 處理取得員工當日排班（用於打卡驗證，所有人都可查）
 */
function handleGetEmployeeShiftForDate(params) {
  try {
    if (!params.token || !validateSession(params.token)) {
      return { ok: false, msg: "未授權或 session 已過期" };
    }
    
    if (!params.employeeId || !params.date) {
      return { ok: false, msg: "缺少必要參數" };
    }
    
    Logger.log(' 查詢員工排班: ' + params.employeeId + ', 日期: ' + params.date);
    
    const result = getEmployeeShiftForDate(params.employeeId, params.date);
    return { 
      ok: result.success, 
      hasShift: result.hasShift,
      data: result.data, 
      msg: result.message 
    };
    
  } catch (error) {
    Logger.log(' handleGetEmployeeShiftForDate 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 處理取得本週排班統計（所有人都可查）
 */
function handleGetWeeklyShiftStats(params) {
  try {
    if (!params.token || !validateSession(params.token)) {
      return { ok: false, msg: "未授權或 session 已過期" };
    }
    
    Logger.log(' 查詢本週排班統計');
    
    const result = getWeeklyShiftStats();
    return { 
      ok: result.success, 
      data: result.data, 
      msg: result.message 
    };
    
  } catch (error) {
    Logger.log(' handleGetWeeklyShiftStats 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 處理匯出排班資料（⭐ 支援排班人員權限）
 */
function handleExportShifts(params) {
  try {
    // ⭐ 修正：使用排班權限檢查
    const permCheck = checkSchedulingPermission(params.token);
    if (!permCheck.ok) {
      return permCheck;
    }
    
    Logger.log(' 匯出排班資料（by ' + permCheck.user.name + '）');
    
    const filters = {
      employeeId: params.employeeId,
      startDate: params.startDate,
      endDate: params.endDate,
      shiftType: params.shiftType
    };
    
    const result = exportShifts(filters);
    return { 
      ok: result.success, 
      data: result.data, 
      filename: result.filename, 
      msg: result.message 
    };
    
  } catch (error) {
    Logger.log(' handleExportShifts 錯誤: ' + error);
    return { ok: false, msg: error.message };
  }
}

/**
 * 測試排班系統
 */
function testShiftAPI() {
  Logger.log('===== 測試排班 API =====');
  
  // 模擬前端請求參數
  const testParams = {
    token: '2d3ce046-3dcc-4a62-ac92-ac0c87993669',  // 請替換成真實的 token
    employeeId: 'U123456',
    employeeName: '測試員工',
    date: '2025-10-25',
    shiftType: '早班',
    startTime: '09:00',
    endTime: '18:00',
    location: '台北辦公室',
    note: '測試排班'
  };
  
  // 測試新增排班
  const addResult = handleAddShift(testParams);
  Logger.log('新增排班結果: ' + JSON.stringify(addResult));
  
  // 測試查詢排班
  const queryParams = {
    token: '2d3ce046-3dcc-4a62-ac92-ac0c87993669',
    employeeId: 'U123456'
  };
  const queryResult = handleGetShifts(queryParams);
  Logger.log('查詢排班結果: ' + JSON.stringify(queryResult));
}



// ==================== 薪資系統 Handler 函數 ====================

/**
 *  處理設定員工薪資（完整版 - 含所有 27 個參數）
 * 
 * 修正內容：
 * 1. 補齊 6 個固定津貼參數
 * 2. 補齊 4 個其他扣款參數
 * 3. 加入詳細的 Logger 輸出
 */
function handleSetEmployeeSalaryTW(params) {
  try {
    Logger.log('═══════════════════════════════════════');
    Logger.log(' 開始設定員工薪資（完整版）');
    Logger.log('═══════════════════════════════════════');
    
    // Session 驗證
    if (!params.token || !validateSession(params.token)) {
      Logger.log(' Session 驗證失敗');
      return { ok: false, msg: "未授權或 session 已過期" };
    }
    
    Logger.log(' Session 驗證成功');
    
    // ⭐⭐⭐ 完整的 salaryData 物件（27 個參數）
    const salaryData = {
      // ========== 基本資訊 (6 個參數: A-F) ==========
      employeeId: params.employeeId,
      employeeName: params.employeeName,
      idNumber: params.idNumber,
      employeeType: params.employeeType,
      salaryType: params.salaryType,
      baseSalary: parseFloat(params.baseSalary) || 0,
      
      // ========== ⭐ 固定津貼 (6 個參數: G-L) ==========
      positionAllowance: parseFloat(params.positionAllowance) || 0,      // G: 職務加給
      mealAllowance: parseFloat(params.mealAllowance) || 0,              // H: 伙食費
      transportAllowance: parseFloat(params.transportAllowance) || 0,    // I: 交通補助
      attendanceBonus: parseFloat(params.attendanceBonus) || 0,          // J: 全勤獎金
      performanceBonus: parseFloat(params.performanceBonus) || 0,        // K: 業績獎金
      otherAllowances: parseFloat(params.otherAllowances) || 0,          // L: 其他津貼
      
      // ========== 銀行資訊 (4 個參數: M-P) ==========
      bankCode: params.bankCode,
      bankAccount: params.bankAccount,
      hireDate: params.hireDate,
      paymentDay: params.paymentDay,
      
      // ========== 法定扣款 (6 個參數: Q-V) ==========
      pensionSelfRate: parseFloat(params.pensionSelfRate) || 0,
      laborFee: parseFloat(params.laborFee) || 0,
      healthFee: parseFloat(params.healthFee) || 0,
      employmentFee: parseFloat(params.employmentFee) || 0,
      pensionSelf: parseFloat(params.pensionSelf) || 0,
      incomeTax: parseFloat(params.incomeTax) || 0,
      
      // ========== ⭐ 其他扣款 (4 個參數: W-Z) ==========
      welfareFee: parseFloat(params.welfareFee) || 0,                    // W: 福利金扣款
      dormitoryFee: parseFloat(params.dormitoryFee) || 0,                // X: 宿舍費用
      groupInsurance: parseFloat(params.groupInsurance) || 0,            // Y: 團保費用
      otherDeductions: parseFloat(params.otherDeductions) || 0,          // Z: 其他扣款
      
      // ========== 備註 (1 個參數: AB) ==========
      note: params.note
    };
    
    Logger.log(' salaryData 組裝完成（共 27 個參數）');
    Logger.log('   - 基本薪資: ' + salaryData.baseSalary);
    Logger.log('   - 職務加給: ' + salaryData.positionAllowance);
    Logger.log('   - 伙食費: ' + salaryData.mealAllowance);
    Logger.log('   - 交通補助: ' + salaryData.transportAllowance);
    Logger.log('   - 全勤獎金: ' + salaryData.attendanceBonus);
    Logger.log('   - 業績獎金: ' + salaryData.performanceBonus);
    Logger.log('   - 其他津貼: ' + salaryData.otherAllowances);
    Logger.log('   - 福利金: ' + salaryData.welfareFee);
    Logger.log('   - 宿舍費用: ' + salaryData.dormitoryFee);
    Logger.log('   - 團保費用: ' + salaryData.groupInsurance);
    Logger.log('   - 其他扣款: ' + salaryData.otherDeductions);
    
    Logger.log(' 開始儲存薪資設定...');
    
    // 呼叫核心函數
    const result = setEmployeeSalaryTW(salaryData);
    
    Logger.log(' 儲存結果: ' + (result.success ? '成功' : '失敗'));
    Logger.log('   訊息: ' + result.message);
    Logger.log('═══════════════════════════════════════');
    
    return { 
      ok: result.success, 
      msg: result.message,
      data: result 
    };
    
  } catch (error) {
    Logger.log(' handleSetEmployeeSalaryTW 錯誤: ' + error);
    Logger.log(' 錯誤堆疊: ' + error.stack);
    return { ok: false, msg: error.message };
  }
}

/**
 * 處理取得員工薪資
 */
function handleGetEmployeeSalaryTW(params) {
  try {
    if (!params.token || !validateSession(params.token)) {
      return { ok: false, msg: "未授權" };
    }
    
    const result = getEmployeeSalaryTW(params.employeeId);
    return { ok: result.success, data: result.data, msg: result.message };
    
  } catch (error) {
    return { ok: false, msg: error.message };
  }
}


// LineBotPunch.gs - 補充缺少的函數

/**
 * 發送簡單文字回覆
 */
function replyMessage(replyToken, text) {
  const message = {
    type: 'text',
    text: text
  };
  
  sendLineReply_(replyToken, [message]);
}

/**
 *  測試函數：模擬收到「打卡」訊息
 */
function testLineBotMessage() {
  Logger.log(' 測試 LINE Bot 打卡流程');
  Logger.log('');
  
  // 模擬 LINE Webhook 事件
  const testEvent = {
    postData: {
      contents: JSON.stringify({
        events: [
          {
            type: 'message',
            replyToken: 'test-reply-token-12345',
            source: {
              userId: 'U68e0ca9d516e63ed15bf9387fad174ac' //  替換成你的 LINE User ID
            },
            message: {
              type: 'text',
              text: '打卡'
            }
          }
        ]
      })
    },
    parameter: {},
    headers: {
      'X-Line-Signature': 'test-signature'
    }
  };
  
  Logger.log(' 模擬發送訊息...');
  const result = doPost(testEvent);
  
  Logger.log('');
  Logger.log(' 結果:');
  Logger.log(result.getContent());
}

/**
 *  測試函數：模擬收到位置訊息
 */
function testLineBotLocation() {
  Logger.log(' 測試 LINE Bot 位置打卡');
  Logger.log('');
  
  // 模擬位置訊息
  const testEvent = {
    postData: {
      contents: JSON.stringify({
        events: [
          {
            type: 'message',
            replyToken: 'test-reply-token-67890',
            source: {
              userId: 'U68e0ca9d516e63ed15bf9387fad174ac' //  替換成你的 LINE User ID
            },
            message: {
              type: 'location',
              latitude: 25.0330,  //  替換成你的測試座標
              longitude: 121.5654,
              address: '測試地址'
            }
          }
        ]
      })
    },
    parameter: {},
    headers: {
      'X-Line-Signature': 'test-signature'
    }
  };
  
  Logger.log(' 模擬傳送位置...');
  const result = doPost(testEvent);
  
  Logger.log('');
  Logger.log(' 結果:');
  Logger.log(result.getContent());
}