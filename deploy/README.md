# RemindMe 雲端部署手冊

這份手冊從「**已經能用 SSH 連進 Oracle Cloud 的 Ubuntu ARM VM**」開始。每一步都有可以直接複製貼上的指令，以及「怎麼確認這一步成功了」。

部署完成後的架構：

```
桌面版 App ──HTTPS──▶ Caddy（80/443，自動申請憑證）──▶ backend（NestJS，內部 3000）──▶ db（PostgreSQL 16，內部 5432）
```

三個服務都由 `deploy/docker-compose.prod.yml` 管理，只有 Caddy 對外開 port。

> 下面的指令都假設 VM 使用者是 `ubuntu`（Oracle Ubuntu 映像檔的預設使用者），repo 放在 `~/remind_me`。

---

## 0. 事前準備（在電腦上，不是在 VM 裡）

1. **DuckDNS 網域**：到 <https://www.duckdns.org> 登入，建立一個子網域（例如 `remindme-xxx`），把 `current ip` 填成 VM 的**公開 IP**，按 `update ip`。
2. **Oracle 主控台的 Security List**：VM 所在 VCN → Subnet → Security List → Add Ingress Rules，新增兩條：
   - Source CIDR `0.0.0.0/0`、IP Protocol `TCP`、Destination Port `80`
   - Source CIDR `0.0.0.0/0`、IP Protocol `TCP`、Destination Port `443`

✅ **確認**：在自己電腦上執行（把網域換成你的）

```bash
nslookup remindme-xxx.duckdns.org
```

回傳的 Address 要等於 VM 的公開 IP。DNS 剛設定可能要等幾分鐘。

---

## 1. 基本設定與 swap（建議）

```bash
sudo apt-get update && sudo apt-get -y upgrade
sudo apt-get install -y git curl ca-certificates
```

ARM VM 第一次 build 後端映像檔時記憶體用量較高，若 VM 記憶體 ≤ 4 GB，建議先加 4 GB swap，避免 build 被系統砍掉：

```bash
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

✅ **確認**：`free -h` 的 `Swap:` 那一行顯示 `4.0Gi`。

（選用）把 VM 的時區設成台灣，讓 crontab 的「凌晨 3 點」就是台灣時間。這**不影響**提醒的時間判斷——後端一律依照每個使用者自己的時區計算。

```bash
sudo timedatectl set-timezone Asia/Taipei
```

---

## 2. 安裝 Docker Engine 與 compose plugin（Ubuntu arm64 官方方式）

```bash
# 移除可能衝突的舊套件（沒有裝過會顯示找不到，沒關係）
for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do sudo apt-get remove -y $pkg; done

# 加入 Docker 官方 apt 套件庫
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安裝
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 讓 ubuntu 使用者不用 sudo 就能用 docker
sudo usermod -aG docker $USER
```

**接著登出再重新 SSH 登入**（群組變更要重新登入才會生效）。

✅ **確認**：

```bash
docker run --rm hello-world
docker compose version
```

第一個指令印出 `Hello from Docker!`，第二個印出 `Docker Compose version v2.x.x`。

---

## 3. 開放 VM 內部防火牆（最常見的卡關點）

Oracle 的 Ubuntu 映像檔**除了主控台的 Security List 之外，VM 內部還有預設的 iptables 規則**，只放行 SSH（22），其他連線一律 REJECT。只開 Security List 是不夠的。

先看目前的規則：

```bash
sudo iptables -L INPUT -n --line-numbers
```

會看到類似這樣，最後一條是 `REJECT ... reject-with icmp-host-prohibited`：

```
num  target  prot opt source     destination
1    ACCEPT  all  --  0.0.0.0/0  0.0.0.0/0   state RELATED,ESTABLISHED
2    ACCEPT  icmp --  0.0.0.0/0  0.0.0.0/0
3    ACCEPT  all  --  0.0.0.0/0  0.0.0.0/0
4    ACCEPT  udp  --  0.0.0.0/0  0.0.0.0/0   udp spt:123
5    ACCEPT  tcp  --  0.0.0.0/0  0.0.0.0/0   state NEW tcp dpt:22
6    REJECT  all  --  0.0.0.0/0  0.0.0.0/0   reject-with icmp-host-prohibited
```

在 22 那條的**後面**（REJECT 的前面）插入 80 與 443。下面的指令會自動找到 22 那條的位置：

```bash
LINE=$(sudo iptables -L INPUT -n --line-numbers | awk '/dpt:22/ {print $1; exit}')
sudo iptables -I INPUT $((LINE + 1)) -p tcp -m state --state NEW --dport 80 -j ACCEPT
sudo iptables -I INPUT $((LINE + 2)) -p tcp -m state --state NEW --dport 443 -j ACCEPT
sudo iptables -I INPUT $((LINE + 3)) -p udp --dport 443 -j ACCEPT
```

讓規則在重開機後保留：

```bash
sudo apt-get install -y netfilter-persistent iptables-persistent
sudo netfilter-persistent save
```

（安裝 `iptables-persistent` 時若跳出「Save current IPv4 rules?」，選 **Yes**。）

✅ **確認**：

```bash
sudo iptables -L INPUT -n --line-numbers
```

`dpt:80`、`dpt:443` 的 ACCEPT 要出現在 `REJECT` **之前**。再確認存檔內容：

```bash
grep -E 'dport (80|443)' /etc/iptables/rules.v4
```

要看到三行（80/tcp、443/tcp、443/udp）。

> ⚠️ 不要執行 `sudo ufw enable` 或 `sudo iptables -F`。前者會和 Oracle 預設規則打架，後者會清掉所有規則，包含 Oracle 的必要規則。

---

## 4. 下載程式碼、建立設定檔

```bash
cd ~
git clone https://github.com/Sherryli112/remind_me.git
cd ~/remind_me
cp deploy/.env.example deploy/.env
```

（repo 是公開的，clone 不需要登入 GitHub；下載下來的資料夾名稱是 `remind_me`。）

產生密碼與密鑰（各執行一次，把輸出複製下來）：

```bash
openssl rand -hex 32       # 給 POSTGRES_PASSWORD
openssl rand -base64 48    # 給 JWT_ACCESS_SECRET
```

編輯設定檔：

```bash
nano deploy/.env
```

把這三個值改掉，其他維持預設即可：

| 變數 | 填什麼 |
|------|--------|
| `DOMAIN` | 你的 DuckDNS 網域，例如 `remindme-xxx.duckdns.org`（不要加 `https://`） |
| `POSTGRES_PASSWORD` | 上面 `openssl rand -hex 32` 的輸出 |
| `JWT_ACCESS_SECRET` | 上面 `openssl rand -base64 48` 的輸出 |

（nano 存檔：`Ctrl+O` → `Enter`；離開：`Ctrl+X`。）

```bash
chmod 600 deploy/.env
```

> ⚠️ `POSTGRES_PASSWORD` **第一次啟動之後就不要再改**。PostgreSQL 只有在資料庫第一次初始化時才會套用這個密碼，之後改 `.env` 會導致後端連不上資料庫（見常見問題）。

✅ **確認**：

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env config --quiet && echo 設定OK
```

印出 `設定OK`。如果出現 `required variable ... is missing a value`，代表 `deploy/.env` 有變數沒填。

---

## 5. 第一次啟動

```bash
cd ~/remind_me
./deploy/deploy.sh
```

第一次會下載映像檔並 build 後端，ARM VM 上大約 3–10 分鐘。腳本會：

1. `git pull`
2. build 並啟動 `db`、`backend`、`caddy`
3. 等後端 `/health` 回應（後端啟動時會自動執行資料庫 migration）
4. 從外部打 `https://<DOMAIN>/health` 確認 HTTPS 正常

✅ **確認**：最後印出

```
{"status":"ok"}
部署完成：https://remindme-xxx.duckdns.org
```

也可以在自己電腦的瀏覽器打開 `https://<DOMAIN>/health`，要看到 `{"status":"ok"}`，網址列有鎖頭。API 文件在 `https://<DOMAIN>/docs`。

> 第一次部署時 Caddy 申請憑證需要幾十秒，如果腳本說「後端在 VM 內部正常，但從 https://... 連不到」，等 1 分鐘後執行 `curl https://<DOMAIN>/health` 再確認一次。還是不行請看最後的常見問題。

---

## 6. 日常維運

以下指令都在 `~/remind_me` 執行。為了少打字，可以先設定一個別名（加到 `~/.bashrc` 就會永久生效）：

```bash
echo "alias dc='docker compose -f ~/remind_me/deploy/docker-compose.prod.yml --env-file ~/remind_me/deploy/.env'" >> ~/.bashrc
source ~/.bashrc
```

### 更新到最新版本

```bash
cd ~/remind_me
./deploy/deploy.sh
```

可以重複執行；沒有新 commit 時只會確認服務正常。新版本若有資料庫 migration，後端啟動時會自動套用。

✅ **確認**：最後印出 `部署完成`。

### 查看狀態

```bash
dc ps
```

三個服務的 `STATUS` 都要是 `Up`，backend 要顯示 `(healthy)`。

### 看 log

```bash
dc logs -f --tail=100 backend   # 後端（Ctrl+C 離開）
dc logs -f --tail=100 caddy     # HTTPS / 憑證
dc logs -f --tail=100 db        # 資料庫
```

### 重啟

```bash
dc restart backend    # 只重啟後端
dc restart            # 全部重啟
```

注意：重啟後端會清掉記憶體中的「延後提醒」狀態（已知限制），正在延後中的提醒可能會提早或重新跳出。

### 停止 / 啟動

```bash
dc down        # 停止並移除容器（資料保留在 volume 裡）
dc up -d       # 再啟動
```

> ⚠️ **不要**執行 `dc down -v`：`-v` 會把資料庫與憑證的 volume 一起刪掉，資料無法復原。

---

## 7. 備份與還原

### 手動備份

```bash
~/remind_me/deploy/backup.sh
```

✅ **確認**：印出 `備份完成：/home/ubuntu/remindme-backups/remindme-20261119-030000.sql.gz（12K）` 之類的訊息。

```bash
ls -lh ~/remindme-backups/
```

備份檔是 `pg_dump` 的 SQL，用 gzip 壓縮；腳本只保留最近 14 份，較舊的會自動刪除。

### 每天凌晨 3 點自動備份（crontab）

```bash
(crontab -l 2>/dev/null | grep -v 'deploy/backup.sh'; echo "0 3 * * * $HOME/remind_me/deploy/backup.sh >> $HOME/remindme-backups/backup.log 2>&1") | crontab -
mkdir -p ~/remindme-backups
```

（「凌晨 3 點」是 VM 的系統時間；沒有做第 1 步的時區設定的話是 UTC 3 點 = 台灣上午 11 點。）

✅ **確認**：

```bash
crontab -l
```

要看到 `0 3 * * * /home/ubuntu/remind_me/deploy/backup.sh >> ...` 這一行。隔天執行 `tail ~/remindme-backups/backup.log` 要看到備份完成的訊息。

### 把備份下載到自己電腦（建議定期做）

在**自己電腦**上執行（換成你的 SSH 金鑰、IP）：

```bash
scp -i ~/.ssh/你的金鑰 'ubuntu@<VM公開IP>:~/remindme-backups/*.sql.gz' ./
```

### 還原

> ⚠️ 還原會用備份檔**覆蓋**目前資料庫的所有資料。建議先手動跑一次 `backup.sh` 保留現狀。

```bash
cd ~/remind_me
ls -1t ~/remindme-backups/*.sql.gz | head     # 找出要還原的檔案
BACKUP=~/remindme-backups/remindme-20261119-030000.sql.gz   # ← 換成要還原的檔名

dc stop backend
gunzip -c "$BACKUP" | dc exec -T db psql -U remindme -d remindme -v ON_ERROR_STOP=1 --single-transaction
dc start backend
```

✅ **確認**：`psql` 沒有印出 `ERROR`，且 `curl https://<DOMAIN>/health` 回 `{"status":"ok"}`，用桌面版登入後資料是備份當時的狀態。

---

## 8. 常見問題

### Caddy 拿不到憑證／`https://<DOMAIN>` 打不開

看 Caddy 的 log：

```bash
dc logs --tail=100 caddy
```

| log 裡看到 | 原因與處理 |
|-----------|-----------|
| `NXDOMAIN`、`no such host`、`DNS problem` | DuckDNS 還沒指向 VM 或還沒生效。回到第 0 步確認 `nslookup <DOMAIN>` 回傳的是 VM 公開 IP。 |
| `Timeout during connect`、`connection refused`、`likely firewall problem` | 80/443 沒開。檢查第 0 步的 Security List **和**第 3 步的 iptables（兩個都要開）。 |
| `too many certificates already issued`、`rateLimited` | 短時間內申請太多次，被 Let's Encrypt 限流。等 1 小時以上再 `dc restart caddy`，期間不要反覆刪除 `caddy_data` volume。 |

從 VM 外部測試 80 port 有沒有通（在**自己電腦**執行）：

```bash
curl -v http://<DOMAIN>/health
```

有回應（就算是轉址到 https 的 308）代表 80 有通；`Connection refused` 或卡住代表防火牆沒開。

修好之後：

```bash
dc restart caddy
```

### 後端連不到資料庫

```bash
dc logs --tail=100 backend
```

- 看到 `P1001: Can't reach database server`：db 還沒起來。執行 `dc ps` 確認 db 是 `healthy`，再 `dc restart backend`。
- 看到 `P1000: Authentication failed`：資料庫第一次初始化之後又改了 `POSTGRES_PASSWORD`。把 `deploy/.env` 改回原本的密碼後 `dc up -d`。如果原本的密碼找不回來，而且資料庫裡**沒有需要保留的資料**，才可以重建資料庫：

  ```bash
  dc down
  docker volume rm remindme_pg_data     # ⚠️ 會刪掉所有資料
  ./deploy/deploy.sh
  ```

- 看到 migration 相關錯誤（`P3009` 等）：把完整 log 存下來回報給開發者，不要自行刪除資料庫。

### ARM 上 build 很慢或卡住、被 Killed

- 第一次 build 本來就比較久（3–10 分鐘），之後有快取會快很多。
- log 出現 `Killed`、`exit code: 137`、`JavaScript heap out of memory`：記憶體不足。照第 1 步加 swap，然後重跑 `./deploy/deploy.sh`。
- 確認記憶體與 swap：`free -h`；確認磁碟空間：`df -h /`（建議至少留 5 GB）。磁碟不夠時可以清掉沒用到的 build 快取：

  ```bash
  docker builder prune -f
  docker image prune -f
  ```

### `permission denied while trying to connect to the Docker daemon socket`

第 2 步的 `usermod` 之後還沒重新登入。登出 SSH 再登入一次。

### `deploy.sh` 在 `git pull` 失敗

通常是 VM 上的檔案被手動改過。看哪些檔案有變更：

```bash
git status
```

如果只是不小心改到，可以還原：`git checkout -- <檔名>`。（`deploy/.env` 不受 git 管理，不會被影響。）

### 想直接連資料庫查資料

```bash
dc exec db psql -U remindme -d remindme
```

（`\dt` 列出資料表，`\q` 離開。）
