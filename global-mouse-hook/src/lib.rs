// lib.rs - объединённая версия с улучшенной Windows реализацией и полной Linux реализацией
// ----------------------------------------------------------------------------
// Windows: взята из lib_fix2.rs с добавлением боковых кнопок мыши (4,5)
// Linux: взята из lib.rs с полной поддержкой кнопок и улучшенным обнаружением устройств
// ----------------------------------------------------------------------------

use napi_derive::napi;
use napi::{
    bindgen_prelude::*,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};

use std::sync::{Mutex, Arc};
use std::thread;

// Простые числовые коды для передачи в JS
const MOUSE_DOWN: u32 = 1;  // Событие нажатия кнопки мыши
const MOUSE_UP: u32 = 2;    // Событие отпускания кнопки мыши
const KEY_DOWN: u32 = 3;    // Событие нажатия клавиши клавиатуры
const KEY_UP: u32 = 4;      // Событие отпускания клавиши клавиатуры

// ------------------------
// WINDOWS РЕАЛИЗАЦИЯ 
// (на основе lib_fix2.rs с добавлением боковых кнопок мыши)
// ------------------------
#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM, BOOL};
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowsHookExW, UnhookWindowsHookEx, CallNextHookEx, GetMessageW, TranslateMessage,
        DispatchMessageW, PostThreadMessageW, GetCurrentThreadId,
        HHOOK, MSG, WH_KEYBOARD_LL, WH_MOUSE_LL, WM_QUIT, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN,
        WM_SYSKEYUP, WM_LBUTTONDOWN, WM_LBUTTONUP, WM_RBUTTONDOWN, WM_RBUTTONUP, WM_MBUTTONDOWN,
        WM_MBUTTONUP, WM_XBUTTONDOWN, WM_XBUTTONUP,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{KBDLLHOOKSTRUCT, MSLLHOOKSTRUCT};

    use std::sync::{MutexGuard};
    use std::collections::HashSet;
    use std::ptr;
    use std::time::Duration;

    // Статические переменные, защищённые Mutex
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
            let kb = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
            let vk = kb.vkCode as u32;
            let is_down = matches!(w_param.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            let is_up = matches!(w_param.0 as u32, WM_KEYUP | WM_SYSKEYUP);

            if is_down || is_up {
                let mut pressed = PRESSED_KEYS.lock().unwrap();
                let mut send_event = true;
                let mut event_type = 0u32;

                if is_down {
                    if pressed.contains(&vk) {
                        send_event = false;
                    } else {
                        pressed.insert(vk);
                        event_type = KEY_DOWN;
                    }
                } else if is_up {
                    pressed.remove(&vk);
                    event_type = KEY_UP;
                }

                if send_event && event_type != 0 {
                    if let Some(tsfn) = KEYBOARD_CALLBACK.lock().unwrap().as_ref() {
                        let _ = tsfn.call(Ok((vk, event_type)), ThreadsafeFunctionCallMode::NonBlocking);
                    }
                }
            }
        }
        CallNextHookEx(HHOOK(0), n_code, w_param, l_param)
    }

    // Low-level процедура перехвата событий мыши Windows (с поддержкой боковых кнопок)
    unsafe extern "system" fn lowlevel_mouse_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let ms = &*(l_param.0 as *const MSLLHOOKSTRUCT);
            let w = w_param.0 as u32;
            
            // Обработка всех кнопок мыши включая боковые (4,5)
            let (maybe_button, event_type) = match w {
                WM_LBUTTONDOWN => (Some(1u32), MOUSE_DOWN),
                WM_LBUTTONUP => (Some(1u32), MOUSE_UP),
                WM_RBUTTONDOWN => (Some(2u32), MOUSE_DOWN),
                WM_RBUTTONUP => (Some(2u32), MOUSE_UP),
                WM_MBUTTONDOWN => (Some(3u32), MOUSE_DOWN),
                WM_MBUTTONUP => (Some(3u32), MOUSE_UP),
                WM_XBUTTONDOWN | WM_XBUTTONUP => {
                    // Извлекаем информацию о боковой кнопке из mouseData
                    let xbutton = (ms.mouseData >> 16) as u16;
                    let button = if xbutton == 1 { 4 } else { 5 };
                    let event = if w == WM_XBUTTONDOWN { MOUSE_DOWN } else { MOUSE_UP };
                    (Some(button), event)
                }
                _ => (None, 0u32),
            };

            if let Some(button) = maybe_button {
                if let Some(tsfn) = MOUSE_CALLBACK.lock().unwrap().as_ref() {
                    let _ = tsfn.call(Ok((button, event_type)), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        }
        CallNextHookEx(HHOOK(0), n_code, w_param, l_param)
    }

    // Создает и запускает поток с циклом сообщений Windows
    fn ensure_hook_thread() {
        let mut handle_lock = HOOK_THREAD_HANDLE.lock().unwrap();
        if handle_lock.is_some() {
            return;
        }

        let join_handle = thread::spawn(|| {
            unsafe {
                let kb_hook = SetWindowsHookExW(WH_KEYBOARD_LL, Some(lowlevel_keyboard_proc), HINSTANCE(0), 0);
                let ms_hook = SetWindowsHookExW(WH_MOUSE_LL, Some(lowlevel_mouse_proc), HINSTANCE(0), 0);

                {
                    let mut hooks = HOOKS.lock().unwrap();
                    *hooks = Some((ms_hook, kb_hook));
                }

                let tid = GetCurrentThreadId();
                {
                    let mut id_lock = HOOK_THREAD_ID.lock().unwrap();
                    *id_lock = Some(tid);
                }

                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).into() {
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                let mut hooks = HOOKS.lock().unwrap();
                if let Some((ms, kb)) = *hooks {
                    let _ = UnhookWindowsHookEx(ms);
                    let _ = UnhookWindowsHookEx(kb);
                }
                *hooks = None;

                let mut id_lock = HOOK_THREAD_ID.lock().unwrap();
                *id_lock = None;
            }
        });

        *handle_lock = Some(join_handle);
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<(u32,u32)>) -> Result<()> {
        {
            let mut cb_lock = KEYBOARD_CALLBACK.lock().unwrap();
            *cb_lock = Some(callback);
        }
        ensure_hook_thread();
        Ok(())
    }

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<(u32,u32)>) -> Result<()> {
        {
            let mut cb_lock = MOUSE_CALLBACK.lock().unwrap();
            *cb_lock = Some(callback);
        }
        ensure_hook_thread();
        Ok(())
    }

    #[napi]
    pub fn stop_global_keyboard_hook() -> Result<()> {
        {
            let mut cb_lock = KEYBOARD_CALLBACK.lock().unwrap();
            *cb_lock = None;
        }
        Ok(())
    }

    #[napi]
    pub fn stop_global_mouse_hook() -> Result<()> {
        {
            let mut cb_lock = MOUSE_CALLBACK.lock().unwrap();
            *cb_lock = None;
        }
        Ok(())
    }

    #[napi]
    pub fn stop_all_hooks() -> Result<()> {
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
// (полная версия из lib.rs с поддержкой всех кнопок и улучшенным обнаружением устройств)
// ------------------------
#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use evdev::{Device, EventType, InputEvent};
    use std::fs::File;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;
    use lazy_static::lazy_static;

    lazy_static! {
        static ref MOUSE_CALLBACK: Mutex<Option<ThreadsafeFunction<(u32, u32)>>> = Mutex::new(None);
        static ref KEYBOARD_CALLBACK: Mutex<Option<ThreadsafeFunction<(u32, u32)>>> = Mutex::new(None);
        static ref RUNNING: AtomicBool = AtomicBool::new(false);
    }

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<(u32, u32)>) -> Result<()> {
        println!("[RUST-LINUX] 🚀 Starting global mouse hook...");
        *MOUSE_CALLBACK.lock().unwrap() = Some(callback);
        RUNNING.store(true, Ordering::SeqCst);
        
        thread::spawn(move || {
            monitor_input_devices(true);
        });
        
        Ok(())
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<(u32, u32)>) -> Result<()> {
        println!("[RUST-LINUX] 🚀 Starting global keyboard hook...");
        *KEYBOARD_CALLBACK.lock().unwrap() = Some(callback);
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
                
                println!("[RUST-LINUX] 🖱 Sending mouse event: button={}, type={}", button_code, event_type);
                
                if let Ok(callback_guard) = MOUSE_CALLBACK.lock() {
                    if let Some(ref callback) = *callback_guard {
                        let status = callback.call(Ok((button_code, event_type)), ThreadsafeFunctionCallMode::NonBlocking);
                        if status != Status::Ok {
                            eprintln!("[RUST-LINUX] ❌ Error calling mouse callback: {:?}", status);
                        } else {
                            println!("[RUST-LINUX] ✅ Mouse event sent successfully");
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
                
                println!("[RUST-LINUX] ⌨ Sending keyboard event: code={}, type={}", key_code, event_type);
                
                if let Ok(callback_guard) = KEYBOARD_CALLBACK.lock() {
                    if let Some(ref callback) = *callback_guard {
                        let status = callback.call(Ok((key_code, event_type)), ThreadsafeFunctionCallMode::NonBlocking);
                        if status != Status::Ok {
                            eprintln!("[RUST-LINUX] ❌ Error calling keyboard callback: {:?}", status);
                        } else {
                            println!("[RUST-LINUX] ✅ Keyboard event sent successfully");
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
        *MOUSE_CALLBACK.lock().unwrap() = None;
        Ok(())
    }

    #[napi]
    pub fn stop_global_keyboard_hook() -> Result<()> {
        println!("[RUST-LINUX] 🛑 Stopping keyboard hook...");
        RUNNING.store(false, Ordering::SeqCst);
        *KEYBOARD_CALLBACK.lock().unwrap() = None;
        Ok(())
    }

    #[napi]
    pub fn stop_all_hooks() -> Result<()> {
        println!("[RUST-LINUX] 🛑 Stopping all hooks...");
        RUNNING.store(false, Ordering::SeqCst);
        *MOUSE_CALLBACK.lock().unwrap() = None;
        *KEYBOARD_CALLBACK.lock().unwrap() = None;
        Ok(())
    }
}

// ------------------------
// КРОССПЛАТФОРМЕННЫЙ РЕЭКСПОРТ
// ------------------------
#[cfg(target_os = "windows")]
pub use platform::*;

#[cfg(target_os = "linux")]
pub use platform::*;

// ------------------------
// ОБЩИЕ ЭКСПОРТЫ ДЛЯ N-API
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