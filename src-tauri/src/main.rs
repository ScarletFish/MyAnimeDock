// 在 Windows 上隐藏控制台窗口（仅在 release 模式生效，dev 模式保留控制台输出）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use std::process::Command;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use log::{info, warn};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct SidecarProcess(Mutex<Option<std::process::Child>>);

/// 判断是否应自行启动 sidecar：
/// - 生产构建（release）始终启动
/// - dev 模式设置 `TAURI_PROD=1` 时也会启动（用于测试生产流程，无需打包 MSI）
fn should_spawn_sidecar() -> bool {
    !cfg!(debug_assertions) || std::env::var("TAURI_PROD").is_ok()
}

/// 获取 .port 文件路径（与 Node.js 端 DATA_DIR 保持一致）。
/// 生产模式：%APPDATA%/MyAnimeDock/.port
/// 开发模式：server/.port（仅在手动启动时有用，sidecar 模式不读）
fn port_file_path() -> PathBuf {
    if cfg!(debug_assertions) {
        // dev 模式：server/.port（与 server/lib/config.js DATA_DIR 一致）
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        exe_dir.join("server").join(".port")
    } else {
        // 生产模式：%APPDATA%/MyAnimeDock/.port
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(appdata).join("MyAnimeDock").join(".port")
    }
}

/// 读取 .port 文件获取实际端口号，最多等待 10 秒。
/// 如果文件始终不存在（非 sidecar 场景），回退到默认端口 3456。
fn read_actual_port() -> u16 {
    let port_file = port_file_path();
    for _ in 0..20 {
        if port_file.exists() {
            match std::fs::read_to_string(&port_file) {
                Ok(s) => {
                    if let Ok(port) = s.trim().parse::<u16>() {
                        return port;
                    }
                    warn!("Invalid .port content: '{}', using default 3456", s.trim());
                    return 3456;
                }
                Err(e) => warn!("Failed to read .port: {}", e),
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    warn!(".port file not found after 10s, falling back to 3456");
    3456
}

fn main() {
    env_logger::init();
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarProcess(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle();
            
            // 生产模式或 TAURI_PROD=1 时自行启动 sidecar；
            // 普通 dev 模式由手动 `npm run dev:server` 提供后端
            if should_spawn_sidecar() {
                let sidecar_path = get_sidecar_path(&handle)?;
                info!("Starting sidecar: {:?}", sidecar_path);
                
                let mut cmd = Command::new(&sidecar_path);
                cmd.current_dir(sidecar_path.parent().unwrap())
                    .env("TAURI_SIDECAR", "1");
                
                // 隐藏 sidecar 的控制台窗口（GUI 应用不应显示后台控制台）
                #[cfg(target_os = "windows")]
                cmd.creation_flags(CREATE_NO_WINDOW);
                
                let child = cmd.spawn()
                    .expect("Failed to start Node.js sidecar");
                
                // 存储 child 以便退出时清理
                if let Ok(mut guard) = handle.state::<SidecarProcess>().0.lock() {
                    *guard = Some(child);
                }
                
                // 监控 sidecar 进程退出 → 自动关闭 Tauri 窗口
                // 当用户在前端点击"退出"时，sidecar 会自我退出，
                // 但 Tauri 窗口不会自动关闭（window.close() 在 WebView 中被阻止）。
                // 此线程检测到 sidecar 退出后，关闭窗口实现完整退出。
                let monitor_handle = handle.clone();
                std::thread::spawn(move || {
                    loop {
                        std::thread::sleep(Duration::from_millis(500));
                        let state = monitor_handle.state::<SidecarProcess>();
                        let (done, is_graceful) = {
                            if let Ok(mut guard) = state.0.lock() {
                                if let Some(ref mut child) = *guard {
                                    match child.try_wait() {
                                        Ok(Some(_)) => (true, true),
                                        _ => (false, false),
                                    }
                                } else {
                                    // Sidecar 已被 CloseRequested 取走（用户手动关窗）
                                    (true, false)
                                }
                            } else {
                                (false, false)
                            }
                        };
                        drop(state);
                        if done {
                            if is_graceful {
                                // 给前端最后一条响应留出刷新时间
                                std::thread::sleep(Duration::from_millis(500));
                                if let Some(window) = monitor_handle.get_webview_window("main") {
                                    let _ = window.close();
                                }
                            }
                            return;
                        }
                    }
                });
            }
            
            // 等待 server 就绪（先读 .port 文件获取实际端口，再轮询 /api/health）
            let handle_clone = handle.clone();
            std::thread::spawn(move || {
                info!("Waiting for server to be ready...");
                let port = read_actual_port();
                wait_for_server_ready(port, &handle_clone);
                info!("Server is ready on port {}, showing window", port);
                
                // server 就绪后，导航到 sidecar 页面并显示窗口
                // 窗口初始隐藏（visible: false），等 DB 加载完后再展示
                let max_nav_attempts = 10;
                let mut shown = false;
                for _i in 0..max_nav_attempts {
                    if let Some(window) = handle_clone.get_webview_window("main") {
                        let url = format!("http://localhost:{}", port);
                        let js = format!("window.location.replace('{}')", url);
                        let _ = window.eval(&js);
                        let _ = window.show();
                        shown = true;
                        break;
                    }
                    std::thread::sleep(Duration::from_millis(500));
                }
                if !shown {
                    // 导航失败时仍然显示窗口，用户可以看到错误信息
                    if let Some(window) = handle_clone.get_webview_window("main") {
                        let _ = window.show();
                    }
                }
            });
            
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // 清理 sidecar 进程（生产模式或 TAURI_PROD=1）
                if should_spawn_sidecar() {
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
    let resource_dir = handle.path().resource_dir()?;
    // 注意: executable_dir() 返回的是用户数据目录，不是安装目录。
    // 需要 current_exe() 获取 MyAnimeDock.exe 的实际位置。
    let exe_dir = std::env::current_exe()?.parent().unwrap().to_path_buf();
    // Tauri v2 将 externalBin "server" 解析为 server-x86_64-pc-windows-msvc.exe 作为源文件名，
    // 最终安装为 server.exe（自动追加 .exe）
    let expected = "server-x86_64-pc-windows-msvc.exe";
    let fallback_base = "server.exe";
    
    // 优先搜索 exe 同级（MSI/NSIS 安装后 externalBin 的位置）
    // 注意: Tauri v2 旧版 externalBin "server.exe" 会产生 server.exe.exe（双 .exe），
    // 我们也搜索此名称作为兼容回退
    let candidates = vec![
        exe_dir.join(expected),
        exe_dir.join(fallback_base),
        exe_dir.join("server.exe.exe"),            // Tauri v2 旧版 externalBin bug 回退
        resource_dir.join(expected),
        resource_dir.join(fallback_base),
        resource_dir.join("server.exe.exe"),        // 同上，resource 目录变体
        resource_dir.join("resources").join(expected),
        resource_dir.join("resources").join(fallback_base),
    ];
    
    for candidate in &candidates {
        if candidate.exists() {
            return Ok(candidate.clone());
        }
    }
    
    Err("Sidecar executable not found".into())
}

fn wait_for_server_ready(port: u16, handle: &tauri::AppHandle) {
    let url = format!("http://localhost:{}/api/health", port);
    for attempt in 1..=45 {
        if let Ok(resp) = ureq::get(&url).call() {
            if resp.status() == 200 {
                // Parse response to check ready flag
                if let Ok(body) = resp.into_body().read_to_string() {
                    if body.contains("\"ready\":true") {
                        info!("Server ready after {attempt} attempts on port {port}");
                        return;
                    }
                }
            }
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    warn!("Server did not become ready within timeout on port {port}");
    // 即使 server 未就绪，也显示窗口（用户可以看到错误信息）
    if let Some(window) = handle.get_webview_window("main") {
        let _ = window.show();
    }
}
