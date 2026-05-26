use std::fs::OpenOptions;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::time::Duration;

pub struct NestjsSidecar {
    child: Arc<Mutex<Option<Child>>>,
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
        let (stdout_stdio, stderr_stdio) = match log_file {
            Some(f) => {
                let f2 = f.try_clone().unwrap_or_else(|_| {
                    OpenOptions::new().write(true).open("nul").unwrap()
                });
                (Stdio::from(f), Stdio::from(f2))
            }
            None => (Stdio::null(), Stdio::null()),
        };

        let mut cmd = Command::new(&node_cmd);
        cmd.arg(&main_js)
            .current_dir(&backend_dir)
            .env("DATABASE_URL", format!("file:{}", db_path))
            .env("PORT", "3000")
            .env("NODE_ENV", "production")
            .stdout(stdout_stdio)
            .stderr(stderr_stdio);
        // CREATE_NO_WINDOW | DETACHED_PROCESS：雙重確保 node.exe 不繼承或建立 console 視窗
        #[cfg(target_os = "windows")]
        cmd.creation_flags(0x08000000 | 0x00000008);
        let child = cmd.spawn()
            .map_err(|e| format!("無法啟動 Node.js: {e}"))?;

        Ok(Self {
            child: Arc::new(Mutex::new(Some(child))),
        })
    }

    pub fn wait_until_ready(&self) -> bool {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();

        for _ in 0..30 {
            if client
                .get("http://localhost:3000/health")
                .send()
                .map(|r| r.status().is_success())
                .unwrap_or(false)
            {
                return true;
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
