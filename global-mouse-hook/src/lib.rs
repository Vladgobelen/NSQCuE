use napi_derive::napi;
use napi::{
    bindgen_prelude::*,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use std::sync::Mutex;
use std::thread;

// Используем простые числовые коды вместо объектов
const MOUSE_DOWN: u32 = 1;
const MOUSE_UP: u32 = 2;
const KEY_DOWN: u32 = 3;
const KEY_UP: u32 = 4;

// ========================
// WINDOWS IMPLEMENTATION
// ========================
#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static MOUSE_CALLBACK: Mutex<Option<ThreadsafeFunction<(u32, u32)>>> = Mutex::new(None);
    static KEYBOARD_CALLBACK: Mutex<Option<ThreadsafeFunction<(u32, u32)>>> = Mutex::new(None);
    static HOOK_THREAD_RUNNING: Mutex<bool> = Mutex::new(false);

    const LLKHF_REPEAT: u32 = 0x4000;

    unsafe extern "system" fn mouse_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let hook_struct = &*(l_param.0 as *const MSLLHOOKSTRUCT);
            
            let (button_code, event_type) = match w_param.0 as u32 {
                WM_LBUTTONDOWN => (1, MOUSE_DOWN),
                WM_LBUTTONUP => (1, MOUSE_UP),
                WM_RBUTTONDOWN => (2, MOUSE_DOWN),
                WM_RBUTTONUP => (2, MOUSE_UP),
                WM_MBUTTONDOWN => (3, MOUSE_DOWN),
                WM_MBUTTONUP => (3, MOUSE_UP),
                WM_XBUTTONDOWN | WM_XBUTTONUP => {
                    let xbutton = (hook_struct.mouseData >> 16) as u16;
                    let button = if xbutton == 1 { 4 } else { 5 };
                    let event = if w_param.0 as u32 == WM_XBUTTONDOWN { MOUSE_DOWN } else { MOUSE_UP };
                    (button, event)
                }
                _ => return CallNextHookEx(None, n_code, w_param, l_param),
            };

            if let Ok(callback_guard) = MOUSE_CALLBACK.lock() {
                if let Some(ref callback) = *callback_guard {
                    let _ = callback.call(Ok((button_code, event_type)), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        }
        CallNextHookEx(None, n_code, w_param, l_param)
    }

    unsafe extern "system" fn keyboard_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let hook_struct = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
            let vk_code = hook_struct.vkCode;
            
            // Filter repeat events
            if (w_param.0 as u32 == WM_KEYDOWN || w_param.0 as u32 == WM_SYSKEYDOWN)
                && (hook_struct.flags & KBDLLHOOKSTRUCT_FLAGS(LLKHF_REPEAT)) != KBDLLHOOKSTRUCT_FLAGS(0)
            {
                return CallNextHookEx(None, n_code, w_param, l_param);
            }

            let event_type = if w_param.0 as u32 == WM_KEYDOWN || w_param.0 as u32 == WM_SYSKEYDOWN {
                KEY_DOWN
            } else {
                KEY_UP
            };

            if let Ok(callback_guard) = KEYBOARD_CALLBACK.lock() {
                if let Some(ref callback) = *callback_guard {
                    let _ = callback.call(Ok((vk_code, event_type)), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        }
        CallNextHookEx(None, n_code, w_param, l_param)
    }

    fn start_message_loop() {
        if *HOOK_THREAD_RUNNING.lock().unwrap() {
            return;
        }
        
        *HOOK_THREAD_RUNNING.lock().unwrap() = true;
        
        thread::spawn(|| {
            unsafe {
                let mut msg = std::mem::MaybeUninit::uninit();
                loop {
                    let result = GetMessageW(msg.as_mut_ptr(), None, 0, 0);
                    if result.0 <= 0 {
                        break;
                    }
                    let msg = msg.assume_init();
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }
            *HOOK_THREAD_RUNNING.lock().unwrap() = false;
        });
    }

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<(u32, u32)>) -> Result<()> {
        *MOUSE_CALLBACK.lock().unwrap() = Some(callback);
        
        unsafe {
            let _hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(mouse_proc),
                Some(HINSTANCE::default()),
                0,
            ).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to set mouse hook: {}", e)))?;
            
            start_message_loop();
        }
        Ok(())
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<(u32, u32)>) -> Result<()> {
        *KEYBOARD_CALLBACK.lock().unwrap() = Some(callback);
        
        unsafe {
            let _hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_proc),
                Some(HINSTANCE::default()),
                0,
            ).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to set keyboard hook: {}", e)))?;
            
            start_message_loop();
        }
        Ok(())
    }

    #[napi]
    pub fn stop_global_mouse_hook() -> Result<()> {
        *MOUSE_CALLBACK.lock().unwrap() = None;
        Ok(())
    }

    #[napi]
    pub fn stop_global_keyboard_hook() -> Result<()> {
        *KEYBOARD_CALLBACK.lock().unwrap() = None;
        Ok(())
    }

    #[napi]
    pub fn stop_all_hooks() -> Result<()> {
        *MOUSE_CALLBACK.lock().unwrap() = None;
        *KEYBOARD_CALLBACK.lock().unwrap() = None;
        Ok(())
    }
}

// ========================
// LINUX IMPLEMENTATION - USING SIMPLE TYPES
// ========================
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

// ========================
// CROSS-PLATFORM EXPORTS
// ========================
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