# 雲端環境開設教學（Oracle Cloud 免費主機）

這份教學帶你從零開始，申請 RemindMe 雲端後端需要的帳號與主機。全部做完之後，接著看 `deploy/README.md`（由部署設定負責的 agent 撰寫），在主機上把後端跑起來。

> ⚠️ 雲端服務的免費方案條款會變動。這份教學依據的是 2026 年中的資訊，申請時請以 Oracle 官網的 **Always Free** 說明頁為準。

## 會用到的東西

| 項目 | 用途 | 費用 |
|------|------|------|
| Oracle Cloud 帳號 | 提供一台一直開著的 ARM 主機，用來跑後端與資料庫 | 免費（申請時需要信用卡驗證身分）|
| DuckDNS 帳號 | 提供一個免費網址（例如 `remindme-sherry.duckdns.org`），HTTPS 憑證需要網址才能申請 | 免費 |
| SSH 金鑰 | 從你的 Mac 安全登入主機用 | 免費 |
| GitHub repository variable | 讓桌面版安裝檔知道要連到哪個雲端網址 | 免費 |

預計時間：1～2 小時（其中 Oracle 帳號審核可能要等幾分鐘到幾小時）。

---

## 第 1 步：產生 SSH 金鑰（在你的 Mac 上）

打開終端機執行：

```bash
ls ~/.ssh/id_ed25519.pub
```

- 如果有顯示檔案路徑，代表你已經有金鑰，直接跳到第 2 步。
- 如果出現 `No such file or directory`，執行下面這行產生一組新的金鑰（一路按 Enter 即可，要不要設密碼看你自己）：

```bash
ssh-keygen -t ed25519 -C "remindme-oracle"
```

之後會用到「公鑰」的內容，用這行就能把公鑰複製到剪貼簿：

```bash
pbcopy < ~/.ssh/id_ed25519.pub
```

> 🔒 `id_ed25519`（沒有 `.pub` 的那個檔案）是私鑰，**絕對不要**上傳或貼給任何人。

---

## 第 2 步：申請 Oracle Cloud 帳號

1. 前往 Oracle Cloud 官網，點 **Start for free**（或「免費試用」）。
2. 填寫 email、國家（Taiwan），完成 email 驗證。
3. 設定帳號資料：
   - **Cloud Account Name**（租用戶名稱）：自訂一個英文名稱，之後登入會用到，請記下來。
   - **Home Region（主要區域）**：⚠️ **選了之後就不能改**，而免費的 ARM 主機只能開在主要區域。建議選：
     - **Japan East (Tokyo)** 或 **Japan Central (Osaka)**：離台灣最近，連線延遲最低。
     - 如果之後開主機一直遇到「Out of capacity」（容量不足），這是熱門區域常見的狀況，詳見第 4 步的說明。
4. 填寫信用卡資料：用來驗證身分，Oracle 會先做一筆小額預授權，之後會自動取消。**只要不升級成付費帳號，就不會扣款。**
5. 送出之後等待帳號開通的 email（通常幾分鐘，偶爾要等到幾小時）。

### （建議）升級成 Pay As You Go，並設定預算警示

Oracle 會回收「長時間閒置」的免費帳號主機。升級成 Pay As You Go（隨用隨付）之後就不會被回收，**而且只要用量在 Always Free 額度內，一樣是 0 元**。升級後也比較不容易遇到容量不足的問題。

如果決定升級，一定要同時設定預算警示，避免不小心開了收費資源還不知道：

1. 主控台左上選單 → **Billing & Cost Management** → **Upgrade and Manage Payment** → 升級成 Pay As You Go。
2. **Billing & Cost Management** → **Budgets** → **Create Budget**：金額設 `1` USD，警示門檻設 `1%`，填上你的 email。這樣只要產生任何費用，你就會馬上收到通知。

如果不想升級也可以，只是要注意主機有被回收的風險（RemindMe 的後端一直在跑排程，CPU 不會完全閒置，風險相對低）。

---

## 第 3 步：開放網路埠（Security List）

主機要對外開放 80（HTTP）和 443（HTTPS）兩個埠，Caddy 才能申請 HTTPS 憑證並對外提供服務。

> 建議第 4 步先建立主機（建立時會一併建立虛擬網路 VCN），再回來做這一步。

1. 主控台左上選單 → **Networking** → **Virtual Cloud Networks**。
2. 點進建立主機時產生的 VCN → **Security Lists**（或在 Subnet 頁面裡）→ **Default Security List**。
3. **Add Ingress Rules**，新增兩條規則：

| Source CIDR | IP Protocol | Destination Port Range |
|-------------|-------------|------------------------|
| `0.0.0.0/0` | TCP | `80` |
| `0.0.0.0/0` | TCP | `443` |

22 埠（SSH）預設就已經開放了，不需要另外新增。

> ⚠️ Oracle 的 Ubuntu 主機**內部**還有一層防火牆（iptables）也會擋 80/443。這一層要等 SSH 進主機之後才能開，`deploy/README.md` 有詳細步驟。這是最常見的卡關點：兩層防火牆都要開，網站才連得到。

---

## 第 4 步：建立免費 ARM 主機

1. 主控台左上選單 → **Compute** → **Instances** → **Create instance**。
2. **Name**：`remindme`。
3. **Image and shape** → **Edit**：
   - **Image**：點 **Change image** → **Ubuntu** → 選 **Canonical Ubuntu 24.04**（或 22.04），版本名稱要有 **aarch64**。
   - **Shape**：點 **Change shape** → **Ampere** → **VM.Standard.A1.Flex**。
     - OCPU：`2`，記憶體：`12 GB`（免費額度最多是 4 OCPU / 24 GB；跑 RemindMe 用 2/12 綽綽有餘，剩下的額度留著以後用）。
     - 確認畫面上有顯示 **Always Free-eligible** 的標記。
4. **Networking**：保持預設，會自動建立新的 VCN 與公開子網路；確認 **Assign a public IPv4 address** 有勾選。
5. **Add SSH keys** → 選 **Paste public keys** → 貼上第 1 步複製的公鑰內容。
6. **Boot volume**：保持預設（免費額度總共 200 GB）。
7. 按 **Create**，等狀態變成綠色的 **Running**。
8. 在主機詳細頁面找到 **Public IP address**，記下來（例如 `140.83.x.x`）。

### 如果出現「Out of capacity for shape VM.Standard.A1.Flex」

這代表該區域的免費 ARM 主機暫時被搶光了，不是你設定錯誤。可以這樣處理：

- 換一個 **Availability Domain**（建立頁面的 Placement 區塊，如果有 AD-2、AD-3 可以選的話）。
- 把規格降到 1 OCPU / 6 GB 再試。
- 隔幾個小時或隔天再試（離峰時段的成功率比較高）。
- 升級成 Pay As You Go（見第 2 步）通常能大幅改善，而且只要在免費額度內一樣是 0 元。

建立好主機之後，回到第 3 步開放網路埠。

---

## 第 5 步：確認可以 SSH 登入

在你的 Mac 終端機執行（把 IP 換成你的主機 IP）：

```bash
ssh ubuntu@140.83.x.x
```

第一次連線會問 `Are you sure you want to continue connecting?`，輸入 `yes`。看到類似 `ubuntu@remindme:~$` 的提示字元就代表成功了。輸入 `exit` 離開。

為了之後方便，可以把連線資訊存成捷徑。在 `~/.ssh/config` 加上：

```
Host remindme
    HostName 140.83.x.x
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519
```

之後只要輸入 `ssh remindme` 就能連線。

---

## 第 6 步：申請 DuckDNS 免費網址

1. 前往 DuckDNS 官網，用 GitHub 或 Google 帳號登入。
2. 在 **sub domain** 欄位輸入想要的名稱（例如 `remindme-sherry`），按 **add domain**。
3. 在剛加入的網址那一列，**current ip** 欄位填上你的主機公開 IP，按 **update ip**。
4. 確認生效（在 Mac 上執行，可能要等 1～2 分鐘）：

```bash
dig +short remindme-sherry.duckdns.org
```

顯示的是你的主機 IP，就代表成功了。

> 你的完整網址就是 `remindme-sherry.duckdns.org`，部署時填到 `deploy/.env` 的 `DOMAIN`。
> Oracle 主機的公開 IP 在主機沒有被刪除重建的情況下不會改變，所以這個步驟只需要做一次。

---

## 第 7 步：在主機上部署後端

照著 `deploy/README.md` 的步驟操作：安裝 Docker、開啟主機內部防火牆、下載程式碼、設定密鑰、啟動。

完成之後，在瀏覽器打開 `https://remindme-sherry.duckdns.org/health`，看到 `{"status":"ok"}` 就代表雲端後端已經在運作了。

> 📌 RemindMe 的 repo 是公開的，在主機上可以直接 `git clone https://github.com/Sherryli112/remind_me.git`，不需要另外設定 GitHub 金鑰。也因為 repo 是公開的，**密碼、密鑰一律只放在主機上的 `deploy/.env`，絕對不要 commit 進 repo。**

---

## 第 8 步：讓桌面版連到雲端

桌面版安裝檔是由 GitHub Actions 打包的，打包時要知道雲端網址：

1. 到 GitHub 上 RemindMe 的 repo → **Settings** → **Secrets and variables** → **Actions** → **Variables** 分頁。
2. **New repository variable**：
   - Name：`API_BASE_URL`
   - Value：`https://remindme-sherry.duckdns.org`（換成你的網址，**結尾不要加 `/`**）
3. 之後推送新的版本 tag（例如 `v0.5.0`）時，打包出來的安裝檔就會自動連到雲端。

本機開發時不需要設定，預設會連到 `http://localhost:3000`。

---

## 完成檢查清單

- [ ] SSH 金鑰已產生
- [ ] Oracle Cloud 帳號開通，Home Region 選了東京或大阪
- [ ] （選擇性）已升級 Pay As You Go，並設定 1 USD 的預算警示
- [ ] ARM 主機（VM.Standard.A1.Flex）狀態為 Running，記下公開 IP
- [ ] Security List 已開放 TCP 80、443
- [ ] `ssh ubuntu@<IP>` 可以登入
- [ ] DuckDNS 網址已指向主機 IP，`dig` 確認生效
- [ ] 依 `deploy/README.md` 部署完成，`https://<網址>/health` 回傳 `{"status":"ok"}`
- [ ] GitHub repository variable `API_BASE_URL` 已設定
