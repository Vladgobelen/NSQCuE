use napi_derive::napi;
use napi::{
    bindgen_prelude::*,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use std::sync::{Arc, Mutex};
use std::thread;

#[napi(object)]
pub struct MouseEvent {
    pub x: i32,
    pub y: i32,
    pub button_code: u32,   // 1 = left, 2 = right, 3 = middle, 4/5 = side
    pub event_type: String, // "down", "up"
}

#[napi(object)]
pub struct KeyEvent {
    pub code: u32,          // Linux: evdev code, Windows: VK
    pub event_type: String, // "down", "up"
}

// ========================
// WINDOWS
// ========================
#[cfg(target_os = "windows")]
mod platform {
    use super::*;
    use std::sync::LazyLock;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static MOUSE_CALLBACK: LazyLock<Mutex<Option<ThreadsafeFunction<MouseEvent>>>> =
        LazyLock::new(|| Mutex::new(None));
    static KEYBOARD_CALLBACK: LazyLock<Mutex<Option<ThreadsafeFunction<KeyEvent>>>> =
        LazyLock::new(|| Mutex::new(None));

    const LLKHF_REPEAT: u32 = 0x4000;

    unsafe extern "system" fn mouse_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let ms = &*(l_param.0 as *const MSLLHOOKSTRUCT);
            let detail = (ms.mouseData >> 16) as u16;
            let button_code = match w_param.0 as u32 {
                WM_LBUTTONDOWN | WM_LBUTTONUP => 1,
                WM_RBUTTONDOWN | WM_RBUTTONUP => 2,
                WM_MBUTTONDOWN | WM_MBUTTONUP => 3,
                WM_XBUTTONDOWN | WM_XBUTTONUP => {
                    if detail == 0x0001 { 4 } else { 5 }
                }
                WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
                    return CallNextHookEx(None, n_code, w_param, l_param);
                }
                _ => return CallNextHookEx(None, n_code, w_param, l_param),
            };
            let event_type = if w_param.0 as u32 == WM_LBUTTONDOWN
                || w_param.0 as u32 == WM_RBUTTONDOWN
                || w_param.0 as u32 == WM_MBUTTONDOWN
                || w_param.0 as u32 == WM_XBUTTONDOWN
            {
                "down"
            } else {
                "up"
            };
            let evt = MouseEvent {
                x: ms.pt.x,
                y: ms.pt.y,
                button_code,
                event_type: event_type.to_string(),
            };
            if let Ok(g) = MOUSE_CALLBACK.lock() {
                if let Some(ref f) = *g {
                    let _ = f.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        }
        CallNextHookEx(None, n_code, w_param, l_param)
    }

    unsafe extern "system" fn keyboard_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let kbd = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
            let vk = kbd.vkCode;
            if (w_param.0 as u32 == WM_KEYDOWN || w_param.0 as u32 == WM_SYSKEYDOWN)
                && (kbd.flags & KBDLLHOOKSTRUCT_FLAGS(LLKHF_REPEAT)) != KBDLLHOOKSTRUCT_FLAGS(0)
            {
                return CallNextHookEx(None, n_code, w_param, l_param);
            }
            let event_type = if w_param.0 as u32 == WM_KEYDOWN || w_param.0 as u32 == WM_SYSKEYDOWN {
                "down"
            } else {
                "up"
            };
            let evt = KeyEvent {
                code: vk,
                event_type: event_type.to_string(),
            };
            if let Ok(g) = KEYBOARD_CALLBACK.lock() {
                if let Some(ref f) = *g {
                    let _ = f.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                }
            }
        }
        CallNextHookEx(None, n_code, w_param, l_param)
    }

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<MouseEvent>) -> Result<()> {
        if let Ok(mut g) = MOUSE_CALLBACK.lock() {
            *g = Some(callback);
        }
        unsafe {
            SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(mouse_proc),
                Some(HINSTANCE(std::ptr::null_mut())),
                0,
            )
            .unwrap();
            thread::spawn(|| {
                let mut msg: MSG = std::mem::zeroed();
                loop {
                    let ret = GetMessageW(&mut msg, None, 0, 0);
                    if ret.0 == 0 || ret.0 == -1 {
                        break;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            });
        }
        Ok(())
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<KeyEvent>) -> Result<()> {
        if let Ok(mut g) = KEYBOARD_CALLBACK.lock() {
            *g = Some(callback);
        }
        unsafe {
            SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_proc),
                Some(HINSTANCE(std::ptr::null_mut())),
                0,
            )
            .unwrap();
            thread::spawn(|| {
                let mut msg: MSG = std::mem::zeroed();
                loop {
                    let ret = GetMessageW(&mut msg, None, 0, 0);
                    if ret.0 == 0 || ret.0 == -1 {
                        break;
                    }
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            });
        }
        Ok(())
    }
}

// ========================
// LINUX — исправлено под evdev 0.13
// ========================
#[cfg(target_os = "linux")]
mod platform {
    use super::*;
    use evdev::{Device, InputEvent, KeyCode};
    use std::fs::File;
    use std::path::Path;

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<MouseEvent>) -> Result<()> {
        start_input_monitor(callback, true)
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<KeyEvent>) -> Result<()> {
        start_input_monitor(callback, false)
    }

    fn start_input_monitor(
        callback: ThreadsafeFunction<MouseEvent>,
        is_mouse: bool,
    ) -> Result<()> {
        thread::spawn(move || {
            if let Ok(entries) = std::fs::read_dir("/dev/input") {
                for entry in entries {
                    if let Ok(entry) = entry {
                        let path = entry.path();
                        if !path.file_name().unwrap().to_str().unwrap().starts_with("event") {
                            continue;
                        }

                        if let Ok(file) = File::open(&path) {
                            if let Ok(device) = Device::open(&path) {
                                let name = device.name().unwrap_or("unknown");
                                let is_keyboard = device.supported_keys().map_or(false, |keys| {
                                    keys.contains(KeyCode::KEY_A)
                                });
                                let is_mouse = device
                                    .supported_relative_axes()
                                    .map_or(false, |axes| !axes.is_empty())
                                    || device
                                        .supported_buttons()
                                        .map_or(false, |btns| !btns.is_empty());

                                if (is_mouse && !is_mouse_device(&device)) || (is_keyboard && is_mouse) {
                                    continue;
                                }

                                if (is_mouse && is_mouse) || (!is_mouse && is_keyboard) {
                                    let cb = Arc::new(Mutex::new(Some(callback.clone())));
                                    std::thread::spawn(move || {
                                        for event in device.into_event_stream().unwrap() {
                                            if let Ok(event) = event {
                                                if let InputEvent::Key(key_event) = event {
                                                    let code = key_event.key().0 as u32;
                                                    let pressed = key_event.value() == 1;
                                                    let event_type = if pressed { "down" } else { "up" };

                                                    if is_mouse {
                                                        if let Some(button_code) = evdev_key_to_mouse_button(code) {
                                                            let evt = MouseEvent {
                                                                x: 0,
                                                                y: 0,
                                                                button_code,
                                                                event_type: event_type.to_string(),
                                                            };
                                                            if let Ok(g) = cb.lock() {
                                                                if let Some(ref f) = *g {
                                                                    let _ = f.call(
                                                                        Ok(evt),
                                                                        ThreadsafeFunctionCallMode::NonBlocking,
                                                                    );
                                                                }
                                                            }
                                                        }
                                                    } else {
                                                        let evt = KeyEvent {
                                                            code,
                                                            event_type: event_type.to_string(),
                                                        };
                                                        if let Ok(g) = cb.lock() {
                                                            if let Some(ref f) = *g {
                                                                let _ = f.call(
                                                                    Ok(evt),
                                                                    ThreadsafeFunctionCallMode::NonBlocking,
                                                                );
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    }
                }
            }
        });
        Ok(())
    }

    fn is_mouse_device(device: &Device) -> bool {
        device
            .supported_relative_axes()
            .map_or(false, |axes| !axes.is_empty())
            || device
                .supported_buttons()
                .map_or(false, |btns| !btns.is_empty())
    }

    fn evdev_key_to_mouse_button(code: u32) -> Option<u32> {
        match code {
            272 => Some(1), // BTN_LEFT
            273 => Some(2), // BTN_RIGHT
            274 => Some(3), // BTN_MIDDLE
            275 => Some(4), // BTN_SIDE
            276 => Some(5), // BTN_EXTRA
            _ => None,
        }
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
    Ok(())
}

#[napi]
pub fn stop_global_keyboard_hook() -> Result<()> {
    Ok(())
}