use napi_derive::napi;
use napi::{
    bindgen_prelude::*,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

#[napi(object)]
pub struct MouseEvent {
    pub x: i32,
    pub y: i32,
    pub button_code: u32,
    pub event_type: String,
}

#[napi(object)]
pub struct KeyEvent {
    pub code: u32,
    pub event_type: String,
}

// ========================
// WINDOWS
// ========================
#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static MOUSE_CALLBACK: Mutex<Option<ThreadsafeFunction<MouseEvent>>> = Mutex::new(None);
    static KEYBOARD_CALLBACK: Mutex<Option<ThreadsafeFunction<KeyEvent>>> = Mutex::new(None);
    
    static MOUSE_HOOK: Mutex<Option<HHOOK>> = Mutex::new(None);
    static KEYBOARD_HOOK: Mutex<Option<HHOOK>> = Mutex::new(None);

    static HOOK_THREAD_RUNNING: Mutex<bool> = Mutex::new(false);

    const LLKHF_REPEAT: u32 = 0x4000;

    unsafe extern "system" fn mouse_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let hook_struct = &*(l_param.0 as *const MSLLHOOKSTRUCT);
            
            let (button_code, event_type) = match w_param.0 as u32 {
                WM_LBUTTONDOWN => (1, "down"),
                WM_LBUTTONUP => (1, "up"),
                WM_RBUTTONDOWN => (2, "down"),
                WM_RBUTTONUP => (2, "up"),
                WM_MBUTTONDOWN => (3, "down"),
                WM_MBUTTONUP => (3, "up"),
                WM_XBUTTONDOWN | WM_XBUTTONUP => {
                    let xbutton = (hook_struct.mouseData >> 16) as u16;
                    let button = if xbutton == 1 { 4 } else { 5 };
                    let event = if w_param.0 as u32 == WM_XBUTTONDOWN { "down" } else { "up" };
                    (button, event)
                }
                _ => return CallNextHookEx(None, n_code, w_param, l_param),
            };

            let evt = MouseEvent {
                x: hook_struct.pt.x,
                y: hook_struct.pt.y,
                button_code,
                event_type: event_type.to_string(),
            };

            if let Ok(callback_guard) = MOUSE_CALLBACK.lock() {
                if let Some(ref callback) = *callback_guard {
                    let _ = callback.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        }
        CallNextHookEx(None, n_code, w_param, l_param)
    }

    unsafe extern "system" fn keyboard_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let hook_struct = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
            let vk_code = hook_struct.vkCode;
            
            // Фильтруем повторные нажатия
            if (w_param.0 as u32 == WM_KEYDOWN || w_param.0 as u32 == WM_SYSKEYDOWN)
                && (hook_struct.flags & KBDLLHOOKSTRUCT_FLAGS(LLKHF_REPEAT)) != KBDLLHOOKSTRUCT_FLAGS(0)
            {
                return CallNextHookEx(None, n_code, w_param, l_param);
            }

            let event_type = if w_param.0 as u32 == WM_KEYDOWN || w_param.0 as u32 == WM_SYSKEYDOWN {
                "down"
            } else {
                "up"
            };

            let evt = KeyEvent {
                code: vk_code,
                event_type: event_type.to_string(),
            };

            if let Ok(callback_guard) = KEYBOARD_CALLBACK.lock() {
                if let Some(ref callback) = *callback_guard {
                    let _ = callback.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
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
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<MouseEvent>) -> Result<()> {
        *MOUSE_CALLBACK.lock().unwrap() = Some(callback);
        
        unsafe {
            let hook = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(mouse_proc),
                HINSTANCE::default(),
                0,
            ).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to set mouse hook: {}", e)))?;
            
            *MOUSE_HOOK.lock().unwrap() = Some(hook);
            start_message_loop();
        }
        Ok(())
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<KeyEvent>) -> Result<()> {
        *KEYBOARD_CALLBACK.lock().unwrap() = Some(callback);
        
        unsafe {
            let hook = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_proc),
                HINSTANCE::default(),
                0,
            ).map_err(|e| Error::new(Status::GenericFailure, format!("Failed to set keyboard hook: {}", e)))?;
            
            *KEYBOARD_HOOK.lock().unwrap() = Some(hook);
            start_message_loop();
        }
        Ok(())
    }

    #[napi]
    pub fn stop_global_mouse_hook() -> Result<()> {
        if let Ok(mut hook_guard) = MOUSE_HOOK.lock() {
            if let Some(hook) = hook_guard.take() {
                unsafe {
                    UnhookWindowsHookEx(hook);
                }
            }
        }
        *MOUSE_CALLBACK.lock().unwrap() = None;
        Ok(())
    }

    #[napi]
    pub fn stop_global_keyboard_hook() -> Result<()> {
        if let Ok(mut hook_guard) = KEYBOARD_HOOK.lock() {
            if let Some(hook) = hook_guard.take() {
                unsafe {
                    UnhookWindowsHookEx(hook);
                }
            }
        }
        *KEYBOARD_CALLBACK.lock().unwrap() = None;
        Ok(())
    }
}

// ========================
// LINUX - исправленная версия
// ========================
#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use evdev::{Device, EventType};
    use std::fs::File;
    use std::sync::atomic::{AtomicBool, Ordering};

    static MOUSE_CALLBACK: Mutex<Option<ThreadsafeFunction<MouseEvent>>> = Mutex::new(None);
    static KEYBOARD_CALLBACK: Mutex<Option<ThreadsafeFunction<KeyEvent>>> = Mutex::new(None);

    static RUNNING: AtomicBool = AtomicBool::new(false);

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<MouseEvent>) -> Result<()> {
        *MOUSE_CALLBACK.lock().unwrap() = Some(callback);
        start_input_monitor_mouse()
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<KeyEvent>) -> Result<()> {
        *KEYBOARD_CALLBACK.lock().unwrap() = Some(callback);
        start_input_monitor_keyboard()
    }

    fn start_input_monitor_mouse() -> Result<()> {
        RUNNING.store(true, Ordering::SeqCst);
        
        thread::spawn(move || {
            while RUNNING.load(Ordering::SeqCst) {
                if let Ok(entries) = std::fs::read_dir("/dev/input") {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if !path.to_string_lossy().contains("event") {
                            continue;
                        }

                        if let Ok(file) = File::open(&path) {
                            if let Ok(mut device) = Device::from_fd(file.into()) {
                                if !is_mouse_device(&device) {
                                    continue;
                                }

                                // Обрабатываем события только для мыши
                                if let Ok(events) = device.fetch_events() {
                                    for event in events {
                                        if let EventType::KEY = event.event_type() {
                                            if let Some(button_code) = evdev_key_to_mouse_button(event.code()) {
                                                let pressed = event.value() == 1;
                                                let evt = MouseEvent {
                                                    x: 0,
                                                    y: 0,
                                                    button_code,
                                                    event_type: if pressed { "down" } else { "up" }.to_string(),
                                                };
                                                
                                                // Блокируем мьютекс только на время вызова callback
                                                if let Ok(callback_guard) = MOUSE_CALLBACK.lock() {
                                                    if let Some(ref callback) = *callback_guard {
                                                        let _ = callback.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(10));
            }
        });

        Ok(())
    }

    fn start_input_monitor_keyboard() -> Result<()> {
        RUNNING.store(true, Ordering::SeqCst);
        
        thread::spawn(move || {
            while RUNNING.load(Ordering::SeqCst) {
                if let Ok(entries) = std::fs::read_dir("/dev/input") {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if !path.to_string_lossy().contains("event") {
                            continue;
                        }

                        if let Ok(file) = File::open(&path) {
                            if let Ok(mut device) = Device::from_fd(file.into()) {
                                if !is_keyboard_device(&device) {
                                    continue;
                                }

                                // Обрабатываем события только для клавиатуры
                                if let Ok(events) = device.fetch_events() {
                                    for event in events {
                                        if let EventType::KEY = event.event_type() {
                                            let pressed = event.value() == 1;
                                            let evt = KeyEvent {
                                                code: event.code() as u32,
                                                event_type: if pressed { "down" } else { "up" }.to_string(),
                                            };
                                            
                                            // Блокируем мьютекс только на время вызова callback
                                            if let Ok(callback_guard) = KEYBOARD_CALLBACK.lock() {
                                                if let Some(ref callback) = *callback_guard {
                                                    let _ = callback.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                thread::sleep(Duration::from_millis(10));
            }
        });

        Ok(())
    }

    fn is_mouse_device(device: &Device) -> bool {
        device.supported_events().contains(EventType::KEY) &&
        device.supported_events().contains(EventType::RELATIVE)
    }

    fn is_keyboard_device(device: &Device) -> bool {
        device.supported_events().contains(EventType::KEY) &&
        !is_mouse_device(device)
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
        RUNNING.store(false, Ordering::SeqCst);
        *MOUSE_CALLBACK.lock().unwrap() = None;
        Ok(())
    }

    #[napi]
    pub fn stop_global_keyboard_hook() -> Result<()> {
        RUNNING.store(false, Ordering::SeqCst);
        *KEYBOARD_CALLBACK.lock().unwrap() = None;
        Ok(())
    }
}

// ========================
// EXPORTS
// ========================
#[napi]
pub fn start_global_mouse_hook(callback: ThreadsafeFunction<MouseEvent>) -> Result<()> {
    platform::start_global_mouse_hook(callback)
}

#[napi]
pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<KeyEvent>) -> Result<()> {
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