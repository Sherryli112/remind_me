use std::fs::OpenOptions;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::time::Duration;

pub struct NestjsSidecar {
    child: Arc<Mutex<Option<Child>>>,
    port: Arc<Mutex<Option<u16>>>,
}

impl NestjsSidecar {
    pub fn spawn(backend_dir: PathBuf, db_path: String, exe_dir: PathBuf) -> Result<Self, String> {
        // Production: ncc bundle; fallback to dist/main.js for manual builds
        let bundle = backend_dir.join("bundle").join("index.js");
        let fallback = backend_dir.join("dist").join("main.js");
        let main_js = if bundle.exists() { bundle } else { fallback.clone() };
        if !main_js.exists() {
            return Err(format!(
                "找不到後端入口（試過 bundle/index.js 和 dist/main.js）\n請先執行 cd backend && npm run build",
            ));
        }

        // 優先使用安裝包內附的 node.exe（不需使用者自行安裝 Node.js）；
        // 若不存在（開發環境）則 fallback 到系統 PATH 中的 node。
        let bundled = exe_dir.join(if cfg!(target_os = "windows") { "node.exe" } else { "node" });
        let node_cmd = if bundled.exists() { bundled } else { PathBuf::from("node") };

        // 將 backend 輸出寫入 log 檔，避免彈出 terminal 視窗
        let log_dir = exe_dir.join("logs");
        std::fs::create_dir_all(&log_dir).ok();
        let log_file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(log_dir.join("backend.log"))
            .ok();
        let stderr_stdio = match log_file.as_ref().and_then(|f| f.try_clone().ok()) {
            Some(f) => Stdio::from(f),
            None => Stdio::null(),
        };

        // PORT=0：讓 OS 配一個空閒 port，避免長期佔用 3000（會跟開發者自己的 dev server 衝突）。
        // 後端啟動後會把實際拿到的 port 印成 `RUNTIME_PORT=<port>`，下面的背景 thread 會解析出來。
        let mut cmd = Command::new(&node_cmd);
        cmd.arg(&main_js)
            .current_dir(&backend_dir)
            .env("DATABASE_URL", format!("file:{}", db_path))
            .env("PORT", "0")
            .env("NODE_ENV", "production")
            .stdout(Stdio::piped())
            .stderr(stderr_stdio);
        // CREATE_NO_WINDOW | DETACHED_PROCESS：雙重確保 node.exe 不繼承或建立 console 視窗
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000 | 0x00000008);
        let mut child = cmd.spawn()
            .map_err(|e| format!("無法啟動 Node.js: {e}"))?;

        let port: Arc<Mutex<Option<u16>>> = Arc::new(Mutex::new(None));
        let port_writer = port.clone();
        if let Some(stdout) = child.stdout.take() {
            std::thread::spawn(move || {
                let mut log_file = log_file;
                let reader = BufReader::new(stdout);
                for line in reader.lines().flatten() {
                    if let Some(rest) = line.strip_prefix("RUNTIME_PORT=") {
                        if let Ok(p) = rest.trim().parse::<u16>() {
                            *port_writer.lock().unwrap() = Some(p);
                        }
                    }
                    if let Some(f) = log_file.as_mut() {
                        let _ = writeln!(f, "{line}");
                    }
                }
            });
        }

        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
            port,
        })
    }

    pub fn port(&self) -> Option<u16> {
        *self.port.lock().unwrap()
    }

    pub fn wait_until_ready(&self) -> bool {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();

        for _ in 0..30 {
            if let Some(port) = self.port() {
                if client
                    .get(format!("http://localhost:{port}/health"))
                    .send()
                    .map(|r| r.status().is_success())
                    .unwrap_or(false)
                {
                    return true;
                }
            }
            std::thread::sleep(Duration::from_secs(1));
        }
        false
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.child.lock() {
            if let Some(mut child) = guard.take() {
                let _ = child.kill();
            }
        }
    }
}
