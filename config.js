// config.js

const API_CONFIG = {
  // 正式環境的 API URL
  apiUrl: "https://script.google.com/macros/s/AKfycbw993ETQYXh-HctgGMNvDnBZFjlNRFTcOSy1lqNVwDIZwSn6GGFJyCrXpbSR0BTg7hHkw/exec",
  
  // 新增回呼網址
  redirectUrl: "https://eric693.github.io/yi-chun_check_manager/"
  // 你也可以在這裡加入其他設定，例如：
  // timeout: 5000,
  // version: 'v4.6.0'
};
//  新增：為了兼容性，同時定義全域變數 apiUrl
const apiUrl = API_CONFIG.apiUrl;
