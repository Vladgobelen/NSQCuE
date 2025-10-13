use napi_derive::napi;
use napi::{
    bindgen_prelude::*,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};

use std::sync::Mutex;
use std::thread;

// Простые числовые коды для передачи в JS
const MOUSE_DOWN: u32 = 1;
const MOUSE_UP: u32 = 2;
const KEY_DOWN: u32 = 3;
const KEY_UP: u32 = 4;

// ------------------------
// WINDOWS РЕАЛИЗАЦИЯ 
// ------------------------
use std::fs::OpenOptions;
use std::io::Write;

fn debug_log(msg: &str) {
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open("C:\\hook_debug.log") 
    {
        let _ = writeln!(file, "{}", msg);
    }
}
#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::*;
    use windows::Win32::System::Threading::GetCurrentThreadId;

    use std::collections::HashSet;
    use std::ptr;

    lazy_static::lazy_static! {
        static ref MOUSE_CALLBACK: Mutex<Option<ThreadsafeFunction<(u32,u32)>>> = Mutex::new(None);
        static ref KEYBOARD_CALLBACK: Mutex<Option<ThreadsafeFunction<(u32,u32)>>> = Mutex::new(None);
        static ref HOOKS: Mutex<Option<(HHOOK, HHOOK)>> = Mutex::new(None);
        static ref HOOK_THREAD_ID: Mutex<Option<u32>> = Mutex::new(None);
        static ref HOOK_THREAD_HANDLE: Mutex<Option<std::thread::JoinHandle<()>>> = Mutex::new(None);
        static ref PRESSED_KEYS: Mutex<HashSet<u32>> = Mutex::new(HashSet::new());
    }

    // Low-level процедура перехвата клавиатурных событий Windows
    unsafe extern "system" fn lowlevel_keyboard_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let hook_struct = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
            let vk_code = hook_struct.vkCode as u32;
            
            let event_type = match w_param.0 as u32 {
                WM_KEYDOWN | WM_SYSKEYDOWN => {
                    // Проверяем, не является ли это повторным нажатием
                    let is_repeat = (hook_struct.flags.0 & 0x01) != 0; // LLKHF_REPEAT
                    if is_repeat {
                        // Пропускаем autorepeat события
                        return CallNextHookEx(HHOOK::default(), n_code, w_param, l_param);
                    }
                    KEY_DOWN
                },
                WM_KEYUP | WM_SYSKEYUP => KEY_UP,
                _ => return CallNextHookEx(HHOOK::default(), n_code, w_param, l_param),
            };

            if let Ok(callback_guard) = KEYBOARD_CALLBACK.lock() {
                if let Some(ref callback) = *callback_guard {
                    let _ = callback.call(
                        Ok::<(u32, u32), Error>((vk_code, event_type)), 
                        ThreadsafeFunctionCallMode::NonBlocking
                    );
                }
            }
        }
        CallNextHookEx(HHOOK::default(), n_code, w_param, l_param)
    }

    // Low-level процедура перехвата событий мыши Windows (с поддержкой боковых кнопок)
    unsafe extern "system" fn lowlevel_mouse_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let hook_struct = &*(l_param.0 as *const MSLLHOOKSTRUCT);
            
            let (button_code, event_type) = match w_param.0 as u32 {
                WM_LBUTTONDOWN => (1, MOUSE_DOWN),
                WM_LBUTTONUP => (1, MOUSE_UP),
                WM_RBUTTONDOWN => (2, MOUSE_DOWN),
                WM_RBUTTONUP => (2, MOUSE_UP),
                WM_MBUTTONDOWN => (3, MOUSE_DOWN),
                WM_MBUTTONUP => (3, MOUSE_UP),
                WM_XBUTTONDOWN => {
                    let xbutton = (hook_struct.mouseData >> 16) as u16;
                    let button = if xbutton == 1 { 4 } else { 5 };
                    (button, MOUSE_DOWN)
                },
                WM_XBUTTONUP => {
                    let xbutton = (hook_struct.mouseData >> 16) as u16;
                    let button = if xbutton == 1 { 4 } else { 5 };
                    (button, MOUSE_UP)
                },
                _ => return CallNextHookEx(HHOOK::default(), n_code, w_param, l_param),
            };

            if let Ok(callback_guard) = MOUSE_CALLBACK.lock() {
                if let Some(ref callback) = *callback_guard {
                    let _ = callback.call(
                        Ok::<(u32, u32), Error>((button_code, event_type)), 
                        ThreadsafeFunctionCallMode::NonBlocking
                    );
                }
            }
        }
        CallNextHookEx(HHOOK::default(), n_code, w_param, l_param)
    }

    // Создает и запускает поток с циклом сообщений Windows
    fn ensure_hook_thread() -> Result<()> {
        let mut handle_lock = HOOK_THREAD_HANDLE.lock().unwrap();
        if handle_lock.is_some() {
            return Ok(());
        }

        let join_handle = thread::spawn(|| {
            unsafe {
                // Устанавливаем low-level хук клавиатуры
                let kb_hook = SetWindowsHookExW(
                    WH_KEYBOARD_LL, 
                    Some(lowlevel_keyboard_proc), 
                    HINSTANCE::default(), 
                    0
                );
                
                // Устанавливаем low-level хук мыши
                let ms_hook = SetWindowsHookExW(
                    WH_MOUSE_LL, 
                    Some(lowlevel_mouse_proc), 
                    HINSTANCE::default(), 
                    0
                );

                if kb_hook.is_err() || ms_hook.is_err() {
                    eprintln!("Failed to set Windows hooks");
                    return;
                }

                let kb_hook = kb_hook.unwrap();
                let ms_hook = ms_hook.unwrap();

                // Сохраняем дескрипторы хуков
                {
                    let mut hooks = HOOKS.lock().unwrap();
                    *hooks = Some((ms_hook, kb_hook));
                }

                // Сохраняем ID потока
                let tid = GetCurrentThreadId();
                {
                    let mut id_lock = HOOK_THREAD_ID.lock().unwrap();
                    *id_lock = Some(tid);
                }

                println!("Windows hooks installed successfully, thread ID: {}", tid);

                // Запускаем цикл сообщений
                let mut msg = MSG::default();
                loop {
                    let result = GetMessageW(&mut msg, None, 0, 0);
                    if result.0 <= 0 {
                        break;
                    }
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                println!("Windows message loop ended");

                // Снимаем хуки при завершении
                let mut hooks = HOOKS.lock().unwrap();
                if let Some((ms, kb)) = *hooks {
                    let _ = UnhookWindowsHookEx(ms);
                    let _ = UnhookWindowsHookEx(kb);
                    println!("Windows hooks uninstalled");
                }
                *hooks = None;

                // Очищаем ID потока
                let mut id_lock = HOOK_THREAD_ID.lock().unwrap();
                *id_lock = None;
            }
        });

        *handle_lock = Some(join_handle);
        Ok(())
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<(u32,u32)>) -> Result<()> {
        println!("Starting global keyboard hook on Windows");
        {
            let mut cb_lock = KEYBOARD_CALLBACK.lock().unwrap();
            *cb_lock = Some(callback);
        }
        ensure_hook_thread()?;
        Ok(())
    }

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<(u32,u32)>) -> Result<()> {
        println!("Starting global mouse hook on Windows");
        {
            let mut cb_lock = MOUSE_CALLBACK.lock().unwrap();
            *cb_lock = Some(callback);
        }
        ensure_hook_thread()?;
        Ok(())
    }

    #[napi]
    pub fn stop_global_keyboard_hook() -> Result<()> {
        println!("Stopping global keyboard hook on Windows");
        {
            let mut cb_lock = KEYBOARD_CALLBACK.lock().unwrap();
            *cb_lock = None;
        }
        Ok(())
    }

    #[napi]
    pub fn stop_global_mouse_hook() -> Result<()> {
        println!("Stopping global mouse hook on Windows");
        {
            let mut cb_lock = MOUSE_CALLBACK.lock().unwrap();
            *cb_lock = None;
        }
        Ok(())
    }

    #[napi]
    pub fn stop_all_hooks() -> Result<()> {
        println!("Stopping all hooks on Windows");
        if let Some(tid) = *HOOK_THREAD_ID.lock().unwrap() {
            unsafe {
                let _ = PostThreadMessageW(tid, WM_QUIT, WPARAM(0), LPARAM(0));
            }
            if let Some(join) = HOOK_THREAD_HANDLE.lock().unwrap().take() {
                let _ = join.join();
            }
        }
        {
            let mut c1 = MOUSE_CALLBACK.lock().unwrap();
            *c1 = None;
            let mut c2 = KEYBOARD_CALLBACK.lock().unwrap();
            *c2 = None;
            let mut hooks = HOOKS.lock().unwrap();
            *hooks = None;
        }
        Ok(())
    }
}

// ------------------------
// LINUX РЕАЛИЗАЦИЯ
// ------------------------
#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use evdev::{Device, EventType, InputEvent};
    use std::fs::File;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    lazy_static::lazy_static! {
        static ref MOUSE_CALLBACK: Mutex<Option<ThreadsafeFunction<(u32, u32)>>> = Mutex::new(None);
        static ref KEYBOARD_CALLBACK: Mutex<Option<ThreadsafeFunction<(u32, u32)>>> = Mutex::new(None);
        static ref RUNNING: AtomicBool = AtomicBool::new(false);
    }

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<(u32, u32)>) -> Result<()> {
        println!("[RUST-LINUX] 🚀 Starting global mouse hook...");
        {
            let mut cb_guard = MOUSE_CALLBACK.lock().unwrap();
            *cb_guard = Some(callback);
        }
        RUNNING.store(true, Ordering::SeqCst);
        
        thread::spawn(move || {
            monitor_input_devices(true);
        });
        
        Ok(())
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<(u32, u32)>) -> Result<()> {
        println!("[RUST-LINUX] 🚀 Starting global keyboard hook...");
        {
            let mut cb_guard = KEYBOARD_CALLBACK.lock().unwrap();
            *cb_guard = Some(callback);
        }
        RUNNING.store(true, Ordering::SeqCst);
        
        thread::spawn(move || {
            monitor_input_devices(false);
        });
        
        Ok(())
    }

    fn monitor_input_devices(is_mouse: bool) {
        let device_type = if is_mouse { "mouse" } else { "keyboard" };
        println!("[RUST-LINUX] 🔍 Scanning for {} devices...", device_type);
        
        while RUNNING.load(Ordering::SeqCst) {
            if let Ok(entries) = std::fs::read_dir("/dev/input") {
                for entry in entries.flatten() {
                    if !RUNNING.load(Ordering::SeqCst) {
                        return;
                    }
                    
                    let path = entry.path();
                    let path_str = path.to_string_lossy();
                    
                    if !path_str.contains("event") {
                        continue;
                    }

                    if let Ok(file) = File::open(&path) {
                        if let Ok(device) = Device::from_fd(file.into()) {
                            let is_target_device = if is_mouse {
                                is_mouse_device(&device)
                            } else {
                                is_keyboard_device(&device)
                            };

                            if is_target_device {
                                let device_name = device.name().unwrap_or("Unknown").to_string();
                                println!("[RUST-LINUX] 🎯 Found {} device: {} ({})", device_type, device_name, path_str);
                                
                                if is_mouse {
                                    monitor_device_events(device, true, device_name);
                                } else {
                                    monitor_device_events(device, false, device_name);
                                }
                            }
                        }
                    }
                }
            }
            thread::sleep(Duration::from_millis(5000));
        }
    }

    fn monitor_device_events(mut device: Device, is_mouse: bool, device_name: String) {
        thread::spawn(move || {
            println!("[RUST-LINUX] 📡 Starting event loop for: {}", device_name);
            
            while RUNNING.load(Ordering::SeqCst) {
                match device.fetch_events() {
                    Ok(events) => {
                        for event in events {
                            if is_mouse {
                                handle_mouse_event(event);
                            } else {
                                handle_keyboard_event(event);
                            }
                        }
                    }
                    Err(e) => {
                        println!("[RUST-LINUX] ❌ Error reading from device {}: {}", device_name, e);
                        break;
                    }
                }
            }
            println!("[RUST-LINUX] 📴 Stopped monitoring: {}", device_name);
        });
    }

    fn handle_mouse_event(event: InputEvent) {
        if event.event_type() == EventType::KEY {
            if let Some(button_code) = evdev_key_to_mouse_button(event.code()) {
                let event_type = if event.value() == 1 { MOUSE_DOWN } else { MOUSE_UP };
                
                if let Ok(callback_guard) = MOUSE_CALLBACK.lock() {
                    if let Some(ref callback) = *callback_guard {
                        let status = callback.call(
                            Ok::<(u32, u32), Error>((button_code, event_type)), 
                            ThreadsafeFunctionCallMode::NonBlocking
                        );
                        if status != Status::Ok {
                            eprintln!("[RUST-LINUX] ❌ Error calling mouse callback: {:?}", status);
                        }
                    }
                }
            }
        }
    }

    fn handle_keyboard_event(event: InputEvent) {
        if event.event_type() == EventType::KEY {
            // Skip mouse buttons and filter autorepeat (value == 2)
            if evdev_key_to_mouse_button(event.code()).is_none() && event.value() != 2 {
                let event_type = if event.value() == 1 { KEY_DOWN } else { KEY_UP };
                let key_code = event.code() as u32;
                
                if let Ok(callback_guard) = KEYBOARD_CALLBACK.lock() {
                    if let Some(ref callback) = *callback_guard {
                        let status = callback.call(
                            Ok::<(u32, u32), Error>((key_code, event_type)), 
                            ThreadsafeFunctionCallMode::NonBlocking
                        );
                        if status != Status::Ok {
                            eprintln!("[RUST-LINUX] ❌ Error calling keyboard callback: {:?}", status);
                        }
                    }
                }
            }
        }
    }

    fn is_mouse_device(device: &Device) -> bool {
        let has_relative = device.supported_events().contains(EventType::RELATIVE);
        let has_mouse_buttons = if let Some(keys) = device.supported_keys() {
            keys.iter().any(|code| {
                let code_val = code.code();
                code_val >= 0x110 && code_val <= 0x117 // Mouse buttons range
            })
        } else {
            false
        };
        
        has_relative || has_mouse_buttons
    }

    fn is_keyboard_device(device: &Device) -> bool {
        if !device.supported_events().contains(EventType::KEY) {
            return false;
        }
        
        if let Some(keys) = device.supported_keys() {
            let keyboard_key_count = keys.iter()
                .filter(|code| {
                    let code_val = code.code();
                    // Regular keyboard keys (1-255) excluding mouse buttons
                    (code_val >= 1 && code_val <= 255) && !(code_val >= 0x110 && code_val <= 0x117)
                })
                .count();
            keyboard_key_count > 20 // Require more keys to avoid false positives
        } else {
            false
        }
    }

    fn evdev_key_to_mouse_button(code: u16) -> Option<u32> {
        match code {
            0x110 => Some(1), // BTN_LEFT
            0x111 => Some(2), // BTN_RIGHT
            0x112 => Some(3), // BTN_MIDDLE
            0x113 => Some(4), // BTN_SIDE
            0x114 => Some(5), // BTN_EXTRA
            _ => None,
        }
    }

    #[napi]
    pub fn stop_global_mouse_hook() -> Result<()> {
        println!("[RUST-LINUX] 🛑 Stopping mouse hook...");
        RUNNING.store(false, Ordering::SeqCst);
        {
            let mut cb_guard = MOUSE_CALLBACK.lock().unwrap();
            *cb_guard = None;
        }
        Ok(())
    }

    #[napi]
    pub fn stop_global_keyboard_hook() -> Result<()> {
        println!("[RUST-LINUX] 🛑 Stopping keyboard hook...");
        RUNNING.store(false, Ordering::SeqCst);
        {
            let mut cb_guard = KEYBOARD_CALLBACK.lock().unwrap();
            *cb_guard = None;
        }
        Ok(())
    }

    #[napi]
    pub fn stop_all_hooks() -> Result<()> {
        println!("[RUST-LINUX] 🛑 Stopping all hooks...");
        RUNNING.store(false, Ordering::SeqCst);
        {
            let mut kb_guard = KEYBOARD_CALLBACK.lock().unwrap();
            *kb_guard = None;
            let mut ms_guard = MOUSE_CALLBACK.lock().unwrap();
            *ms_guard = None;
        }
        Ok(())
    }
}

// ------------------------
// КРОССПЛАТФОРМЕННЫЕ ЭКСПОРТЫ
// ------------------------
#[napi]
pub fn start_global_mouse_hook(callback: ThreadsafeFunction<(u32, u32)>) -> Result<()> {
    platform::start_global_mouse_hook(callback)
}

#[napi]
pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<(u32, u32)>) -> Result<()> {
    platform::start_global_keyboard_hook(callback)
}

#[napi]
pub fn stop_global_mouse_hook() -> Result<()> {
    platform::stop_global_mouse_hook()
}

#[napi]
pub fn stop_global_keyboard_hook() -> Result<()> {
    platform::stop_global_keyboard_hook()
}

#[napi]
pub fn stop_all_hooks() -> Result<()> {
    platform::stop_all_hooks()
}