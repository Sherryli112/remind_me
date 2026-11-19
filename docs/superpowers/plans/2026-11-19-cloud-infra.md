# 任務：雲端部署設定（agent `infra`，分支 `feat/cloud-infra`）

先完整讀過 `/Users/work/Desktop/RemindMe/docs/superpowers/specs/2026-11-19-cloud-backend-design.md`，那是規格的唯一依據。後端程式碼由另一個 agent 平行改寫中（改用 PostgreSQL、加上 JWT），你負責的是**讓它能被部署**的所有檔案。規格有衝突或寫不清楚的地方，用最合理的方式處理，並在最終回報裡寫出來，不要停下來等。

## 部署目標

- Oracle Cloud Always Free **ARM（aarch64）** VM，Ubuntu 22.04 或 24.04。使用者會自己開好帳號和 VM（主 session 另外寫教學給他），你的文件從「已經能 SSH 進 VM」開始寫。
- 網域：DuckDNS 免費子網域（例如 `remindme-xxx.duckdns.org`），A 記錄指向 VM 的公開 IP。
- 使用者沒有維運經驗，`deploy/README.md` 的每一步都要有可以直接複製貼上的指令，以及「怎麼確認這一步成功了」。

## 只能修改的路徑

`deploy/**`（新建）、`docker-compose.yml`、`.env.example`、`backend/.env.example`、`backend/Dockerfile`、`backend/entrypoint.sh`、`frontend/Dockerfile`。不要動 `backend/src`、`backend/prisma`、`backend/package.json`、`frontend/src`、`src-tauri/`。

## 工作項目

1. **`backend/Dockerfile`** 改寫成正式環境用的 multi-stage build：
   - 用 `node:20-bookworm-slim`（不要用 alpine，避免 Prisma 的 openssl/musl 問題），要能在 arm64 上直接 build。
   - build stage：`npm ci` → `npx prisma generate` → `npm run build`；runtime stage 只帶 production 依賴、`dist/`、`prisma/`、產生好的 Prisma client。
   - 啟動指令：先 `npx prisma migrate deploy` 再 `node dist/main`。注意 `prisma` CLI 是 devDependency，runtime 要確保能執行 migrate deploy（例如 runtime 階段另外安裝同版本的 prisma CLI，或保留完整 node_modules——選一種並說明理由）。
   - 以非 root 使用者執行。加上 `backend/.dockerignore`（排除 node_modules、dist、bundle、.env、data）。
   - 後端的 schema 正在被另一個 agent 改成 PostgreSQL，你這邊寫 Dockerfile 不需要依賴那份 schema 的內容。
2. **刪除 `backend/entrypoint.sh` 與 `frontend/Dockerfile`**（前端改成 Tauri 內的靜態檔，不部署到雲端）。
3. **根目錄 `docker-compose.yml`** 改成**只給本機開發用**：只留 `db`（postgres:16，port 5432，有 healthcheck 與 volume），移除 backend / frontend service。
4. **`.env.example` 與 `backend/.env.example`**：開發用的 `DATABASE_URL`（指向本機 5432 的 postgres）、`JWT_ACCESS_SECRET` 範例值、規格裡列出的其他變數與預設值，每個變數一行中文註解。
5. **`deploy/docker-compose.prod.yml`**：
   - `db`：postgres:16，**不對外開 port**，volume 持久化，healthcheck。
   - `backend`：build `../backend`，`depends_on` db healthy，環境變數從 `deploy/.env` 讀取，只在內部網路開放 3000，`restart: unless-stopped`。
   - `caddy`：caddy:2，對外開 80/443，掛載 `deploy/Caddyfile`，`caddy_data` / `caddy_config` volume。
6. **`deploy/Caddyfile`**：`{$DOMAIN}` 反向代理到 `backend:3000`，自動 HTTPS。
7. **`deploy/.env.example`**：`DOMAIN`、`POSTGRES_PASSWORD`、`JWT_ACCESS_SECRET`、`CORS_ORIGINS`（正式環境只需要 `http://tauri.localhost,tauri://localhost`）等，附上產生隨機密鑰的指令（`openssl rand -base64 48`）。確認 `deploy/.env` 會被 `.gitignore` 排除（根目錄 `.gitignore` 不在你的範圍內，如果需要修改，寫在回報裡由主 session 處理）。
8. **`deploy/deploy.sh`**：在 VM 上執行，`git pull` → `docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env up -d --build` → 等 `/health` 回應 → 印出結果。要能重複執行。
9. **`deploy/backup.sh`**：`pg_dump` 壓縮備份到 `~/remindme-backups/`，保留最近 14 份；文件附上加進 crontab 的指令（每天凌晨 3 點）與還原指令。
10. **`deploy/README.md`**（繁體中文），從「已經 SSH 進 VM」開始：
    - 安裝 Docker Engine 與 compose plugin（Ubuntu arm64 官方方式）
    - **開放防火牆**：Oracle 的 Ubuntu 映像檔除了雲端主控台的 Security List 之外，VM 內部還有預設的 iptables 規則會擋 80/443，這是最常見的卡關點，要寫清楚怎麼開、怎麼讓規則在重開機後保留（`netfilter-persistent`）
    - clone repo、建立 `deploy/.env`、第一次啟動、確認 `https://<DOMAIN>/health` 回 `{"status":"ok"}`
    - 之後更新版本的方式（`deploy/deploy.sh`）、看 log、重啟、備份與還原
    - 常見問題：Caddy 拿不到憑證（DNS 尚未生效、80 port 沒開）、後端連不到 DB、ARM 上 build 很慢或記憶體不足（建議加 swap 的指令）

## 驗收

- `docker compose -f deploy/docker-compose.prod.yml config` 在填好範例 env 的情況下可以解析成功。
- 在本機（Apple Silicon 也是 arm64）實際 `docker build backend/` 成功。後端程式碼目前還在 main 的 SQLite 版本，所以只需要確認 **build 成功**，不需要確認容器能連上 PostgreSQL 正常啟動——在回報裡註明這點。
- `bash -n deploy/*.sh` 語法檢查通過；有 `shellcheck` 的話也跑一下。
- `docker compose config` 對根目錄的開發用 compose 檔也能解析成功。

## 收尾

- 在 `feat/cloud-infra` 分支上 commit（可以分多個 commit），commit message 用繁體中文，結尾加上：
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- **不要 push、不要合併到 main。**
- 最終回報寫成 Markdown 存到 `/tmp/remindme-handoff/infra.md`（先 `mkdir -p`），內容包含：做了什麼、規格偏離之處與理由、驗收結果、需要其他 agent 或主 session 配合的事項（例如 `.gitignore`）。
- 做完後停止，主 session 會讀取這份回報。
