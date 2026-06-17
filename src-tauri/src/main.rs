use tauri::Manager;
use std::process::Command;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use std::env;

struct SidecarProcess(Mutex<Option<std::process::Child>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle();
            
            // 仅在生产模式下启动 sidecar；开发模式由手动启动的 `node server/server.js` 提供服务
            if !cfg!(debug_assertions) {
                let sidecar_path = get_sidecar_path(&handle)?;
                println!("Starting sidecar: {:?}", sidecar_path);
                
                let child = Command::new(&sidecar_path)
                    .current_dir(sidecar_path.parent().unwrap())
                    .env("TAURI_SIDECAR", "1")
                    .spawn()
                    .expect("Failed to start Node.js sidecar");
                
                // 存储 child 以便退出时清理
                if let Ok(mut guard) = handle.state::<SidecarProcess>().0.lock() {
                    *guard = Some(child);
                }
            }
            
            // 等待 server 就绪（轮询 /api/config）
            let handle_clone = handle.clone();
            std::thread::spawn(move || {
                wait_for_server_ready(&handle_clone);
                // server 就绪后，将窗口导航到 sidecar 页面（保持同源，API 调用正常）
                let max_nav_attempts = 10;
                for _i in 0..max_nav_attempts {
                    if let Some(window) = handle_clone.get_webview_window("main") {
                        let _ = window.eval("window.location.replace('http://localhost:3456')");
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
            });
            
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // 清理 sidecar 进程（生产模式）
                if !cfg!(debug_assertions) {
                    if let Some(sidecar) = window.try_state::<SidecarProcess>() {
                        if let Ok(mut guard) = sidecar.0.lock() {
                            if let Some(mut child) = guard.take() {
                                let _ = child.kill();
                                let _ = child.wait();
                            }
                        }
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn get_sidecar_path(handle: &tauri::AppHandle) -> Result<PathBuf, Box<dyn std::error::Error>> {
    // 在开发模式下，resource_dir 指向 target/debug，但实际资源在 src-tauri/resources
    // 在生产模式下，resource_dir 指向正确的 resources 目录
    let resource_dir = handle.path().resource_dir()?;
    println!("Resource dir: {:?}", resource_dir);
    
    // 尝试多个可能的路径
    let candidates = vec![
        resource_dir.join("server.exe"),
        resource_dir.join("resources").join("server.exe"),
        // 开发模式下的相对路径
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources").join("server.exe"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("src-tauri").join("resources").join("server.exe"),
    ];
    
    for candidate in &candidates {
        println!("Checking sidecar path: {:?} (exists: {})", candidate, candidate.exists());
        if candidate.exists() {
            println!("Found sidecar at: {:?}", candidate);
            return Ok(candidate.clone());
        }
    }
    
    // 最后尝试 exe 目录
    let exe_dir = handle.path().executable_dir()?;
    let exe_sidecar = exe_dir.join("server.exe");
    println!("Checking exe dir sidecar: {:?} (exists: {})", exe_sidecar, exe_sidecar.exists());
    if exe_sidecar.exists() {
        return Ok(exe_sidecar);
    }
    
    Err("Sidecar executable not found".into())
}

fn wait_for_server_ready(handle: &tauri::AppHandle) {
    for _attempt in 0..30 {
        if let Ok(resp) = ureq::get("http://localhost:3456/api/config").call() {
            if resp.status() == 200 {
                println!("Sidecar server ready");
                return;
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    eprintln!("Warning: Sidecar server did not become ready in time");
    
    // 即使 server 未就绪，也显示窗口（用户可以看到错误信息）
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
    }
}