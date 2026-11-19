// 讓所有單元測試都在 UTC 時區執行（模擬雲端主機），確保排程計算不依賴伺服器本地時區。
// globalSetup 在 worker 啟動前執行，worker 會繼承這個環境變數。
module.exports = async () => {
  process.env.TZ = 'UTC';
};
