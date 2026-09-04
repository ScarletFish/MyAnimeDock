// 在 Windows 上隐藏控制台窗口（仅在 release 模式生效，dev 模式保留控制台输出）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{MenuBuilder, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Listener, Manager, WebviewWindowBuilder,
};
use std::process::{Command, Stdio};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use log::{info, warn};
use std::io::{Write, BufRead, BufReader, Read};
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

/// 获取 DATA_DIR（与 Node.js 端 DATA_DIR 保持一致）。
/// 生产模式：%APPDATA%/MyAnimeDock
/// 开发模式：项目根 data/（server/lib/paths.js findServerRoot 定位项目根，此处对称向上遍历）
fn data_dir_path() -> PathBuf {
    if cfg!(debug_assertions) {
        // dev 模式：current_exe 在 src-tauri/target/debug/，向上遍历找项目根
        // （package.json name=anime-manager），join data
        let mut dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from("."));
        for _ in 0..8 {
            let pkg = dir.join("package.json");
            if pkg.exists() {
                if let Ok(s) = std::fs::read_to_string(&pkg) {
                    if s.contains("\"name\": \"anime-manager\"") {
                        return dir.join("data");
                    }
                }
            }
            match dir.parent() {
                Some(p) => dir = p.to_path_buf(),
                None => break,
            }
        }
        // 找不到项目根 → 回退 exe 同级 data（与旧行为一致）
        dir.join("data")
    } else {
        // 生产模式：%APPDATA%/MyAnimeDock
        let appdata = std::env::var("APPDATA").unwrap_or_else(|_| ".".to_string());
        PathBuf::from(appdata).join("MyAnimeDock")
    }
}

/// 获取 .port 文件路径（DATA_DIR/.port）
fn port_file_path() -> PathBuf {
    data_dir_path().join(".port")
}

/// 读取主题模式（config.json 的 themeMode），返回 true = dark / false = light。
/// config.json 缺失或解析失败时默认 dark（与 server 端 DEFAULT_CONFIG 一致）。
fn read_theme_mode() -> bool {
    let cfg_path = data_dir_path().join("config.json");
    match std::fs::read_to_string(&cfg_path) {
        Ok(s) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                let mode = v.get("themeMode").and_then(|m| m.as_str()).unwrap_or("dark");
                return mode != "light";
            }
            true
        }
        Err(_) => true,
    }
}

/// 关闭窗口行为（config.json 的 closeBehavior）。
/// 返回 true = 最小化到系统托盘，false = 直接关闭软件。
/// 默认 tray（与 server 端 DEFAULT_CONFIG 一致），缺失/解析失败时按默认处理。
fn read_close_to_tray() -> bool {
    let cfg_path = data_dir_path().join("config.json");
    match std::fs::read_to_string(&cfg_path) {
        Ok(s) => {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                let behavior = v
                    .get("closeBehavior")
                    .and_then(|b| b.as_str())
                    .unwrap_or("tray");
                return behavior != "exit"; // tray / 其它未知值 → 默认托盘
            }
            true
        }
        Err(_) => true,
    }
}

/// 创建系统托盘图标与菜单。
/// 托盘菜单：显示主窗口 / 退出。
/// - 左键点击托盘图标 → 显示主窗口
/// - "退出" → 清理 sidecar 并真正退出程序
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    // 显示主窗口菜单项
    let show_item = MenuItem::with_id(app, "show", "打开主界面", true, None::<&str>)?;
    // 退出菜单项
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let menu = MenuBuilder::new(app)
        .item(&show_item)
        .separator()
        .item(&quit_item)
        .build()?;

    let mut builder = TrayIconBuilder::with_id("main-tray")
        .menu(&menu)
        .tooltip("MyAnimeDock")
        .show_menu_on_left_click(false)
        .on_menu_event(|app_handle, event| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                // 真正退出：清理 sidecar 后再退出程序（避免托盘中"退出"被 CloseRequested 拦截后仅隐藏）
                cleanup_sidecar(app_handle);
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            // 左键单击托盘图标 → 显示主窗口
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });

    // 优先用应用默认图标（来自 tauri.conf.json bundle.icon）
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

/// 清理 sidecar 子进程（kill + wait）。
fn cleanup_sidecar(app: &tauri::AppHandle) {
    if should_spawn_sidecar() {
        if let Some(state) = app.try_state::<SidecarProcess>() {
            if let Ok(mut guard) = state.0.lock() {
                if let Some(mut child) = guard.take() {
                    let _ = child.kill();
                    let _ = child.wait();
                }
            }
        }
    }
}

/// 读取 .port 文件获取实际端口号（仅 dev 模式使用：server 由外部启动，无 stdout 管道可接）。
/// 最多等待 10 秒；找不到则返回 None（不猜端口，窗口不创建）。
fn read_actual_port() -> Option<u16> {
    let port_file = port_file_path();
    bootstrap_log(&format!("read_actual_port: looking for {:?}", port_file));
    for i in 0..100 {
        if port_file.exists() {
            match std::fs::read_to_string(&port_file) {
                Ok(s) => {
                    if let Ok(port) = s.trim().parse::<u16>() {
                        bootstrap_log(&format!("read_actual_port: found port {}", port));
                        return Some(port);
                    }
                    warn!("Invalid .port content: '{}'", s.trim());
                    return None;
                }
                Err(e) => warn!("Failed to read .port: {}", e),
            }
        } else if i % 25 == 0 {
            bootstrap_log(&format!("read_actual_port: still waiting (attempt {})", i));
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    bootstrap_log("read_actual_port: TIMEOUT after 10s, .port not found");
    warn!(".port file not found after 10s");
    None
}

fn main() {
    bootstrap_log("main() entered");
    env_logger::init();
    tauri::Builder::default()
        // 单实例插件必须第一个注册，确保在其它插件之前生效
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            bootstrap_log("single-instance callback triggered (2nd instance)");
            // 第二次启动时把已有窗口唤起到前台（窗口可能仍处于隐藏加载态，先显示）
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
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

            // 系统托盘（图标 + 菜单：显示主窗口 / 退出）
            if let Err(e) = build_tray(handle) {
                bootstrap_log(&format!("ERROR build_tray: {}", e));
            }

            // 前端渲染完成后显示窗口（窗口先隐藏，避免启动闪烁）。
            // 启动最大化偏好由前端随 app-ready payload 传入（{ startupFullscreen: bool }），
            // 在 show() 之前同步 maximize —— 本窗口是自绘标题栏（decorations(false)），
            // 玻璃无边框形态下"全屏"的期望是最大化（占满工作区、标题栏融入自绘栏、
            // 保留原生可缩放/还原），而非传统独占全屏；独占全屏会丢失缩放能力。
            // 注意：不能在前端隐藏窗口期异步调 maximize（show 时会失效）。
            // 布局列数为纯函数（--card-w 设计常量 + 容器宽），不依赖窗口尺寸
            // 时序，前端无需在最大化前完成任何锚定；前端仅保证 app-ready 携带
            // 该 payload 时首屏已渲染完成（避免显示瞬间还是骨架屏）。
            let ready_handle = handle.clone();
            handle.listen("app-ready", move |event| {
                bootstrap_log("app-ready received, showing window");
                if let Some(window) = ready_handle.get_webview_window("main") {
                    let fullscreen = serde_json::from_str::<serde_json::Value>(event.payload())
                        .ok()
                        .and_then(|v| v.get("startupFullscreen").and_then(|b| b.as_bool()))
                        .unwrap_or(false);
                    if fullscreen {
                        let _ = window.maximize();
                    }
                    let _ = window.show();
                }
            });
            
            // 生产模式或 TAURI_PROD=1 时自行启动 sidecar；
            // 普通 dev 模式由手动 `npm run dev:server` 提供后端
            let spawn = should_spawn_sidecar();
            bootstrap_log(&format!("should_spawn_sidecar() = {}", spawn));
            
            // 端口通知 channel：sidecar 模式由 stdout 读线程解析 PORT= 行后发送，
            // 窗口线程阻塞接收（响应式，无轮询、无超时回退）
            let (port_tx, port_rx) = std::sync::mpsc::channel::<u16>();
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
                    .env("TAURI_SIDECAR", "1")
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped());
                
                // 隐藏 sidecar 的控制台窗口（GUI 应用不应显示后台控制台）
                #[cfg(target_os = "windows")]
                cmd.creation_flags(CREATE_NO_WINDOW);
                
                bootstrap_log("calling cmd.spawn()...");
                let mut child = match cmd.spawn() {
                    Ok(c) => {
                        bootstrap_log("sidecar spawned OK");
                        c
                    }
                    Err(e) => {
                        bootstrap_log(&format!("ERROR cmd.spawn() failed: {}", e));
                        panic!("Failed to start Node.js sidecar: {}", e);
                    }
                };
                
                // 接管 stdout 管道：读线程解析 PORT= 行 → 端口 channel（响应式端口发现）
                if let Some(stdout) = child.stdout.take() {
                    std::thread::spawn(move || {
                        let reader = BufReader::new(stdout);
                        for line in reader.lines() {
                            match line {
                                Ok(l) => {
                                    if let Some(port_str) = l.strip_prefix("PORT=") {
                                        if let Ok(port) = port_str.trim().parse::<u16>() {
                                            bootstrap_log(&format!("stdout reader: got PORT={}", port));
                                            let _ = port_tx.send(port);
                                        }
                                    }
                                }
                                Err(e) => {
                                    bootstrap_log(&format!("stdout reader error: {}", e));
                                    break;
                                }
                            }
                        }
                        bootstrap_log("stdout reader: EOF");
                    });
                }
                
                // 接管 stderr 管道：持续 drain，防止管道缓冲满阻塞 server 日志写入
                if let Some(mut stderr) = child.stderr.take() {
                    std::thread::spawn(move || {
                        let mut buf = [0u8; 4096];
                        loop {
                            match stderr.read(&mut buf) {
                                Ok(0) | Err(_) => break,
                                Ok(_) => {}
                            }
                        }
                    });
                }
                
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
                                // 前端点"退出"→ sidecar 自我退出 → 这里用 app.exit() 真正退出。
                                // 不能用 window.close()：它与 CloseRequested 拦截冲突（tray 模式下
                                // 会被改成隐藏窗口而非退出），导致进程留着死 server 隐藏常驻。
                                monitor_handle.exit(0);
                            }
                            return;
                        }
                    }
                });
            }
            
            // 等待 server 端口后创建窗口（URL 直接指向服务器，无需 placeholder 页面）
            let handle_clone = handle.clone();
            std::thread::spawn(move || {
                let port = if spawn {
                    // sidecar 模式：阻塞等 stdout 管道的 PORT= 行（响应式，无轮询、无超时回退）。
                    // server 未输出 PORT= 就退出 → channel 关闭 → recv 返回 Err → 不建窗。
                    match port_rx.recv() {
                        Ok(p) => {
                            bootstrap_log(&format!("window thread: got port {} from stdout", p));
                            p
                        }
                        Err(_) => {
                            bootstrap_log("ERROR: server exited before reporting PORT, window not created");
                            return;
                        }
                    }
                } else {
                    // dev 模式：server 由外部手动启动（stdout 不归本进程），读 .port 文件
                    match read_actual_port() {
                        Some(p) => p,
                        None => {
                            bootstrap_log("ERROR: .port not found, window not created");
                            return;
                        }
                    }
                };

                let url_str = format!("http://localhost:{}", port);
                let url = match Url::parse(&url_str) {
                    Ok(u) => u,
                    Err(e) => {
                        bootstrap_log(&format!("ERROR Url::parse: {}", e));
                        return;
                    }
                };
                
                bootstrap_log(&format!("creating window with URL: {}", url_str));
                // 窗口背景色按主题模式适配（dark #050505 / light #f2f2f2），
                // 避免 WebView 加载前端前窗口白屏一闪
                let is_dark = read_theme_mode();
                let bg_color = if is_dark {
                    tauri::window::Color(5, 5, 5, 255)
                } else {
                    tauri::window::Color(242, 242, 242, 255)
                };
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
                .background_color(bg_color)
                .visible(false)
                .build()
                {
                    Ok(_) => {
                        bootstrap_log("window created OK");
                        // 安全兜底：3 秒后仍未收到前端 app-ready 事件则强制显示窗口，避免永久黑屏。
                        // 正常流程前端渲染完必发 app-ready；触发此兜底说明 app-ready 链路异常（需排查）。
                        let fb = handle_clone.clone();
                        std::thread::spawn(move || {
                            std::thread::sleep(Duration::from_secs(3));
                            match fb.get_webview_window("main") {
                                Some(w) => {
                                    bootstrap_log("WARN fallback: showing window (app-ready not received in 3s)");
                                    let _ = w.show();
                                }
                                None => bootstrap_log("ERROR fallback: window 'main' not found"),
                            }
                        });
                    }
                    Err(e) => bootstrap_log(&format!("ERROR creating window: {}", e)),
                }
            });
            
            bootstrap_log("setup() returning Ok");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if read_close_to_tray() {
                    // 配置为"最小化到系统托盘"：拦截关闭，隐藏窗口，后台常驻（不杀 sidecar）
                    let _ = window.hide();
                    api.prevent_close();
                    bootstrap_log("CloseRequested intercepted -> minimized to tray");
                } else {
                    // 配置为"直接关闭"：维持原行为 —— 清理 sidecar 进程后允许关闭退出
                    cleanup_sidecar(&window.app_handle());
                    bootstrap_log("CloseRequested -> exiting (closeBehavior=exit)");
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
