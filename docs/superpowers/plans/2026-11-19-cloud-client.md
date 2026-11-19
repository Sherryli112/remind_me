# 任務：桌面版改接雲端（agent `client`，分支 `feat/cloud-client`）

先完整讀過 `/Users/work/Desktop/RemindMe/docs/superpowers/specs/2026-11-19-cloud-backend-design.md`，特別是「API 契約」和「Client 端行為」兩節，那是規格的唯一依據。後端由另一個 agent 平行開發中，你**只能依照規格裡的 API 契約寫程式**，不要等後端完成。規格有衝突或寫不清楚的地方，用最合理的方式處理，並在最終回報裡寫出來，不要停下來等。

`frontend/AGENTS.md` 有說明：這個專案的 Next.js 版本有破壞性變更，寫 Next.js 程式碼之前先讀 `frontend/node_modules/next/dist/docs/` 裡相關的文件（需要先 `npm install`）。

## 只能修改的路徑

`frontend/**`、`src-tauri/**`、`.github/workflows/release.yml`。不要動 `backend/`、`deploy/`、`docker-compose.yml`。

## 工作項目

### 前端（frontend/）

1. **`src/lib/apiBase.ts`**：base URL 改成只讀 `process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000'`，移除 `get_api_base_url` 的輪詢。`apiFetch()` 自動帶上 `Authorization: Bearer` 與 `X-Device-Id`；遇到 401 時 single-flight 呼叫 `/auth/refresh`，成功就重試原請求，失敗就清掉 token 並導向 `/login`。`/auth/*` 本身的請求不要觸發這個 refresh 流程。
2. **`src/lib/auth.ts`**（新檔）：token 與 user 存取（`localStorage` key `remindme.auth`）、裝置 ID（`remindme.deviceId`，沒有就用 `crypto.randomUUID()` 產生並存起來）、login / register / logout / refresh 函式。所有 `localStorage` 存取都要包 try/catch。
3. **`/login` 頁面**（新路由）：登入與註冊在同一頁切換，沿用現有 Mantine + 玻璃毛霧風格與繁體中文介面。註冊時帶上 `Intl.DateTimeFormat().resolvedOptions().timeZone`。顯示規格裡的錯誤代碼對應的中文訊息（`EMAIL_TAKEN`、`INVALID_CREDENTIALS`，以及表單驗證錯誤）。
4. **主頁 `/` 的登入檢查**：沒有 token 就導向 `/login`（這是 `output: export` 的靜態站，只能在 client 端導頁）。側邊欄加上「目前登入的 email」與「登出」按鈕。
5. **與 Rust 同步 session**：在 Tauri 環境下（沿用 `apiBase.ts` 動態 `import('@tauri-apps/api/core')` 的判斷方式），登入、啟動、每次 refresh 成功後都呼叫 `invoke('set_session', { accessToken, deviceId })`；登出時呼叫 `invoke('clear_session')`。主視窗每 10 分鐘主動 refresh 一次，並監聽 Rust 發出的 `session-expired` 事件，收到時立刻 refresh 再 `set_session`。
6. `popup` 與 `popup-manager` 頁面的 `apiFetch` 呼叫不需要個別修改（會自動帶 token），但要確認這兩個頁面在 token 失效時**不會**把彈窗導向 `/login`——彈窗改為靜默失敗即可，導頁只在主視窗做。

### Tauri（src-tauri/）

7. **刪除 `src/sidecar.rs`**，`lib.rs` 移除 release 模式啟動 sidecar 的流程、dev 模式等待 `/health` 的迴圈、`ApiBaseUrl` state 與 `get_api_base_url` command，以及 `RunEvent::Exit` 時 kill sidecar 的程式碼。
8. **API base URL**：`option_env!("REMINDME_API_BASE_URL").unwrap_or("http://localhost:3000")`。
9. **Session state**：新增 `set_session(access_token, device_id)` / `clear_session` command，存在 managed state。`scheduler.rs` 輪詢時帶上 `Authorization` 與 `X-Device-Id`；沒有 session 就跳過這一輪；收到 401 時對主視窗 emit `session-expired`（同一個 token 只 emit 一次，不要每 3 秒狂發）。
10. **`tauri.conf.json`**：移除 `bundle.resources`（node.exe 與 backend bundle）。
11. single-instance plugin 註解裡「避免兩個 sidecar 搶 SQLite」的理由已經不成立，改寫成現在的理由（避免重複開啟兩個常駐列圖示與兩組輪詢），plugin 本身保留。

### Release workflow

12. `.github/workflows/release.yml`：移除下載 portable Node.js 與建置後端的步驟；前端 build 與 tauri build 都要帶上 `NEXT_PUBLIC_API_BASE_URL` 與 `REMINDME_API_BASE_URL`，值來自 GitHub repository variable `${{ vars.API_BASE_URL }}`。release 說明裡「資料儲存於 %APPDATA%...remindme.db」改成「資料儲存於雲端，需登入使用」。

## 驗收

- `cd frontend && npm run build` 通過（靜態輸出到 `frontend/out/`）。
- `cd frontend && npx jest` 既有測試通過。
- `cd src-tauri && cargo check` 通過，沒有新的 warning（原本就存在的 warning 不用處理）。
- 用 `grep -rn sidecar src-tauri/src` 確認沒有殘留。
- 如果後端分支已經可以跑（可以檢查 `/Users/work/Desktop/RemindMe-backend` 是否存在、能否啟動），可以拿來做端對端測試；不行也沒關係，在回報裡說明「尚未對真實後端測試」即可。

## 收尾

- 在 `feat/cloud-client` 分支上 commit（可以分多個 commit），commit message 用繁體中文，結尾加上：
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **不要 push、不要合併到 main。**
- 最終回報寫成 Markdown 存到 `/tmp/remindme-handoff/client.md`（先 `mkdir -p`），內容包含：做了什麼、規格偏離之處與理由、驗收結果、還沒驗證到的部分、需要其他 agent 或主 session 配合的事項。
- 做完後停止，主 session 會讀取這份回報。
