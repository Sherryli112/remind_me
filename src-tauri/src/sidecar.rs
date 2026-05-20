use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub struct NestjsSidecar {
    child: Arc<Mutex<Option<Child>>>,
}

impl NestjsSidecar {
    pub fn spawn(backend_dir: PathBuf, db_path: String, exe_dir: PathBuf) -> Result<Self, String> {
        let main_js = backend_dir.join("dist").join("main.js");
        if !main_js.exists() {
            return Err(format!(
                "找不到 {}\n請先執行 cd backend && npm run build",
                main_js.display()
            ));
        }

        // 優先使用安裝包內附的 node.exe（不需使用者自行安裝 Node.js）；
        // 若不存在（開發環境）則 fallback 到系統 PATH 中的 node。
        let bundled = exe_dir.join(if cfg!(target_os = "windows") { "node.exe" } else { "node" });
        let node_cmd = if bundled.exists() { bundled } else { PathBuf::from("node") };

        let child = Command::new(&node_cmd)
            .arg(&main_js)
            .current_dir(&backend_dir)
            .env("DATABASE_URL", format!("file:{}", db_path))
            .env("PORT", "3000")
            .env("NODE_ENV", "production")
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
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
