// 在 Windows 上隐藏控制台窗口（仅在 release 模式生效，dev 模式保留控制台输出）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, WebviewWindowBuilder};
use std::process::Command;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use log::{info, warn};
use std::io::Write;
use url::Url;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

/// 写入 bootstrap 日志（与 Node 端 server/lib/config.js bootLog 同样的文件）
fn bootstrap_log(msg: &str) {
    let ts = {
        let d = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default();
        // 简单但可读的秒+毫秒时间戳（非严格 ISO，但调试足够）
        format!("{}.{:03}", d.as_secs(), d.subsec_millis())
    };
    let temp = match std::env::var("TEMP") {
        Ok(t) => t,
        Err(_) => return,
    };
    let path = PathBuf::from(temp).join("myanimedock-bootstrap.log");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        let _ = writeln!(f, "[{}] [RUST] {}", ts, msg);
    }
}

struct SidecarProcess(Mutex<Option<std::process::Child>>);

/// 判断是否应自行启动 sidecar：
/// - 生产构建（release）始终启动
/// - dev 模式设置 `TAURI_PROD=1` 时也会启动（用于测试生产流程，无需打包 MSI）
fn should_spawn_sidecar() -> bool {
    !cfg!(debug_assertions) || std::env::var("TAURI_PROD").is_ok()
}

/// 获取 .port 文件路径（与 Node.js 端 DATA_DIR 保持一致）。
/// 生产模式：%APPDATA%/MyAnimeDock/.port
/// 开发模式：data/.port（仅在手动启动时有用，sidecar 模式不读）
fn port_file_path() -> PathBuf {
    if cfg!(debug_assertions) {
        // dev 模式：data/.port（与 server/lib/config.ts DATA_DIR 一致：项目根 data/）
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        exe_dir.join("data").join(".port")
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
    bootstrap_log(&format!("read_actual_port: looking for {:?}", port_file));
    for i in 0..20 {
        if port_file.exists() {
            match std::fs::read_to_string(&port_file) {
                Ok(s) => {
                    if let Ok(port) = s.trim().parse::<u16>() {
                        bootstrap_log(&format!("read_actual_port: found port {}", port));
                        return port;
                    }
                    warn!("Invalid .port content: '{}', using default 3456", s.trim());
                    return 3456;
                }
                Err(e) => warn!("Failed to read .port: {}", e),
            }
        } else if i % 5 == 0 {
            bootstrap_log(&format!("read_actual_port: still waiting (attempt {})", i));
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    bootstrap_log("read_actual_port: TIMEOUT after 10s, falling back to 3456");
    warn!(".port file not found after 10s, falling back to 3456");
    3456
}

fn main() {
    bootstrap_log("main() entered");
    env_logger::init();
    tauri::Builder::default()
        // 单实例插件必须第一个注册，确保在其它插件之前生效
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            bootstrap_log("single-instance callback triggered (2nd instance)");
            // 第二次启动时把已有窗口唤起到前台
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())

        .manage(SidecarProcess(Mutex::new(None)))
        .setup(|app| {
            bootstrap_log("setup() entered");
            let handle = app.handle();
            
            // 生产模式或 TAURI_PROD=1 时自行启动 sidecar；
            // 普通 dev 模式由手动 `npm run dev:server` 提供后端
            let spawn = should_spawn_sidecar();
            bootstrap_log(&format!("should_spawn_sidecar() = {}", spawn));
            if spawn {
                let sidecar_path = match get_sidecar_path(&handle) {
                    Ok(p) => {
                        bootstrap_log(&format!("sidecar path resolved: {:?}", p));
                        p
                    }
                    Err(e) => {
                        bootstrap_log(&format!("ERROR get_sidecar_path: {}", e));
                        return Err(e.into());
                    }
                };
                info!("Starting sidecar: {:?}", sidecar_path);
                
                let mut cmd = Command::new(&sidecar_path);
                cmd.current_dir(sidecar_path.parent().unwrap())
                    .env("TAURI_SIDECAR", "1");
                
                // 隐藏 sidecar 的控制台窗口（GUI 应用不应显示后台控制台）
                #[cfg(target_os = "windows")]
                cmd.creation_flags(CREATE_NO_WINDOW);
                
                bootstrap_log("calling cmd.spawn()...");
                let child = match cmd.spawn() {
                    Ok(c) => {
                        bootstrap_log("sidecar spawned OK");
                        c
                    }
                    Err(e) => {
                        bootstrap_log(&format!("ERROR cmd.spawn() failed: {}", e));
                        panic!("Failed to start Node.js sidecar: {}", e);
                    }
                };
                
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
                    bootstrap_log("sidecar monitor thread started");
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
            
            // 等待 server 就绪后创建窗口（URL 直接指向服务器，无需 placeholder 页面）
            let handle_clone = handle.clone();
            std::thread::spawn(move || {
                bootstrap_log("health check thread started");
                info!("Waiting for server to be ready...");
                let port = read_actual_port();
                bootstrap_log(&format!("read_actual_port() = {}", port));
                wait_for_server_ready(port);
                
                let url_str = format!("http://localhost:{}", port);
                let url = match Url::parse(&url_str) {
                    Ok(u) => u,
                    Err(e) => {
                        bootstrap_log(&format!("ERROR Url::parse: {}", e));
                        return;
                    }
                };
                
                bootstrap_log(&format!("creating window with URL: {}", url_str));
                match WebviewWindowBuilder::new(
                    &handle_clone,
                    "main",
                    tauri::WebviewUrl::External(url),
                )
                .title("MyAnimeDock")
                .inner_size(1920.0, 1080.0)
                .min_inner_size(1280.0, 720.0)
                .center()
                .resizable(true)
                .decorations(false)
                .build()
                {
                    Ok(_) => bootstrap_log("window created OK"),
                    Err(e) => bootstrap_log(&format!("ERROR creating window: {}", e)),
                }
            });
            
            bootstrap_log("setup() returning Ok");
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

fn wait_for_server_ready(port: u16) {
    let url = format!("http://localhost:{}/api/health", port);
    bootstrap_log(&format!("wait_for_server_ready: polling {}", url));
    for attempt in 1..=45 {
        if let Ok(resp) = ureq::get(&url).call() {
            if resp.status() == 200 {
                // Parse response to check ready flag
                if let Ok(body) = resp.into_body().read_to_string() {
                    if body.contains("\"ready\":true") {
                        info!("Server ready after {attempt} attempts on port {port}");
                        bootstrap_log(&format!("server ready after {} attempts", attempt));
                        return;
                    }
                }
            }
        }
        if attempt % 10 == 0 {
            bootstrap_log(&format!("wait_for_server_ready: still waiting (attempt {})", attempt));
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    bootstrap_log("wait_for_server_ready: TIMEOUT after 45 attempts (~22.5s)");
    warn!("Server did not become ready within timeout on port {port}");
    // 窗口将在调用方无条件创建（URL 指向 server），即使未就绪也能让用户看到错误
}
