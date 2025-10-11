use napi_derive::napi;
use napi::{
    bindgen_prelude::*,
    threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode},
};
use std::sync::{Mutex};
use std::thread;

#[napi(object)]
pub struct MouseEvent {
    pub x: i32,
    pub y: i32,
    pub button_code: u32,   // 1 = left, 2 = middle, 3 = right, 4/5 = X buttons
    pub event_type: String, // "down", "up"
}

#[napi(object)]
pub struct KeyEvent {
    pub code: u32,          // keycode (Linux) или virtual key (Windows)
    pub event_type: String, // "down", "up"
}

// ========================
// LINUX (X11)
// ========================
#[cfg(target_os = "linux")]
mod linux {
    use super::*;
    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{ConnectionExt, EventMask, GrabMode, AutoRepeatMode};
    use x11rb::protocol::Event;

    #[napi]
    pub fn start_global_mouse_hook(callback: ThreadsafeFunction<MouseEvent>) -> Result<()> {
        let cb = std::sync::Arc::new(Mutex::new(Some(callback)));
        thread::spawn(move || {
            if let Ok((conn, screen_num)) = x11rb::connect(None) {
                let root = conn.setup().roots[screen_num].root;
                if conn.grab_button(
                    false,
                    root,
                    EventMask::BUTTON_PRESS | EventMask::BUTTON_RELEASE,
                    GrabMode::ASYNC,
                    GrabMode::ASYNC,
                    root,
                    0u32,
                    0u8.into(),
                    0u16.into(),
                ).is_err() {
                    return;
                }
                conn.flush().ok();
                loop {
                    if let Ok(event) = conn.wait_for_event() {
                        match event {
                            Event::ButtonPress(ev) => {
                                if ev.detail == 4 || ev.detail == 5 { continue; } // scroll
                                let evt = MouseEvent {
                                    x: ev.event_x as i32,
                                    y: ev.event_y as i32,
                                    button_code: ev.detail as u32,
                                    event_type: "down".to_string(),
                                };
                                if let Ok(g) = cb.lock() {
                                    if let Some(ref f) = *g {
                                        let _ = f.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                                    }
                                }
                            }
                            Event::ButtonRelease(ev) => {
                                if ev.detail == 4 || ev.detail == 5 { continue; }
                                let evt = MouseEvent {
                                    x: ev.event_x as i32,
                                    y: ev.event_y as i32,
                                    button_code: ev.detail as u32,
                                    event_type: "up".to_string(),
                                };
                                if let Ok(g) = cb.lock() {
                                    if let Some(ref f) = *g {
                                        let _ = f.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        });
        Ok(())
    }

    #[napi]
    pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<KeyEvent>) -> Result<()> {
        let cb = std::sync::Arc::new(Mutex::new(Some(callback)));
        thread::spawn(move || {
            if let Ok((conn, _)) = x11rb::connect(None) {
                let root = conn.setup().roots[0].root;
                if conn.grab_keyboard(
                    false,
                    root,
                    x11rb::protocol::xproto::Time::CURRENT_TIME,
                    GrabMode::ASYNC,
                    GrabMode::ASYNC,
                ).is_err() {
                    return;
                }
                // Отключаем автоповтор на уровне X11
                let _ = conn.change_keyboard_control(
                    &x11rb::protocol::xproto::ChangeKeyboardControlAux::new()
                        .auto_repeat_mode(AutoRepeatMode::OFF)
                );
                conn.flush().ok();
                loop {
                    if let Ok(event) = conn.wait_for_event() {
                        match event {
                            Event::KeyPress(ev) => {
                                let evt = KeyEvent {
                                    code: ev.detail as u32,
                                    event_type: "down".to_string(),
                                };
                                if let Ok(g) = cb.lock() {
                                    if let Some(ref f) = *g {
                                        let _ = f.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                                    }
                                }
                            }
                            Event::KeyRelease(ev) => {
                                let evt = KeyEvent {
                                    code: ev.detail as u32,
                                    event_type: "up".to_string(),
                                };
                                if let Ok(g) = cb.lock() {
                                    if let Some(ref f) = *g {
                                        let _ = f.call(Ok(evt), ThreadsafeFunctionCallMode::NonBlocking);
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        });
        Ok(())
    }
}

// ========================
// WINDOWS
// ========================
#[cfg(target_os = "windows")]
mod windows {
    use super::*;
    use std::sync::LazyLock;
    use ::windows::Win32::Foundation::{HINSTANCE, HWND, BOOL, WPARAM, LPARAM, LRESULT};
    use ::windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, SetWindowsHookExW, UnhookWindowsHookEx,
        GetMessageW, TranslateMessage, DispatchMessageW,
        WH_KEYBOARD_LL, WH_MOUSE_LL,
        WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP,
        WM_LBUTTONDOWN, WM_LBUTTONUP,
        WM_RBUTTONDOWN, WM_RBUTTONUP,
        WM_MBUTTONDOWN, WM_MBUTTONUP,
        WM_XBUTTONDOWN, WM_XBUTTONUP,
        WM_MOUSEWHEEL, WM_MOUSEHWHEEL,
        HHOOK, MSLLHOOKSTRUCT, KBDLLHOOKSTRUCT, MSG,
        KBDLLHOOKSTRUCT_FLAGS,
    };
    use ::windows::Win32::UI::Input::KeyboardAndMouse::{LLKHF_REPEAT, XBUTTON1};

    static MOUSE_CALLBACK: LazyLock<Mutex<Option<ThreadsafeFunction<MouseEvent>>>> =
        LazyLock::new(|| Mutex::new(None));
    static KEYBOARD_CALLBACK: LazyLock<Mutex<Option<ThreadsafeFunction<KeyEvent>>>> =
        LazyLock::new(|| Mutex::new(None));

    unsafe extern "system" fn mouse_proc(n_code: i32, w_param: WPARAM, l_param: LPARAM) -> LRESULT {
        if n_code >= 0 {
            let ms = &*(l_param.0 as *const MSLLHOOKSTRUCT);
            let detail = (ms.mouseData >> 16) as u16;
            let button_code = match w_param.0 as u32 {
                WM_LBUTTONDOWN | WM_LBUTTONUP => 1,
                WM_RBUTTONDOWN | WM_RBUTTONUP => 2,
                WM_MBUTTONDOWN | WM_MBUTTONUP => 3,
                WM_XBUTTONDOWN | WM_XBUTTONUP => {
                    if detail == XBUTTON1 as u16 { 4 } else { 5 }
                }
                WM_MOUSEWHEEL | WM_MOUSEHWHEEL => {
                    return CallNextHookEx(None, n_code, w_param, l_param);
                }
                _ => {
                    return CallNextHookEx(None, n_code, w_param, l_param);
                }
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
            if let Ok(mut g) = MOUSE_CALLBACK.lock() {
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
            // Игнорируем автоповтор
            if (w_param.0 as u32 == WM_KEYDOWN || w_param.0 as u32 == WM_SYSKEYDOWN)
                && (kbd.flags & KBDLLHOOKSTRUCT_FLAGS(LLKHF_REPEAT as u32)) != KBDLLHOOKSTRUCT_FLAGS(0)
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
            if let Ok(mut g) = KEYBOARD_CALLBACK.lock() {
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
            let hook: HHOOK = SetWindowsHookExW(
                WH_MOUSE_LL,
                Some(mouse_proc),
                Some(HINSTANCE(std::ptr::null_mut())),
                0,
            ).unwrap();
            thread::spawn(move || {
                let mut msg: MSG = std::mem::zeroed();
                loop {
                    let ret = GetMessageW(&mut msg, None, 0, 0);
                    if ret.0 == 0 || ret.0 == -1 {
                        break;
                    }
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                UnhookWindowsHookEx(hook);
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
            let hook: HHOOK = SetWindowsHookExW(
                WH_KEYBOARD_LL,
                Some(keyboard_proc),
                Some(HINSTANCE(std::ptr::null_mut())),
                0,
            ).unwrap();
            thread::spawn(move || {
                let mut msg: MSG = std::mem::zeroed();
                loop {
                    let ret = GetMessageW(&mut msg, None, 0, 0);
                    if ret.0 == 0 || ret.0 == -1 {
                        break;
                    }
                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
                UnhookWindowsHookEx(hook);
            });
        }
        Ok(())
    }
}

// ========================
// EXPORTS
// ========================
#[cfg(target_os = "linux")]
#[napi]
pub fn start_global_mouse_hook(callback: ThreadsafeFunction<MouseEvent>) -> Result<()> {
    linux::start_global_mouse_hook(callback)
}

#[cfg(target_os = "windows")]
#[napi]
pub fn start_global_mouse_hook(callback: ThreadsafeFunction<MouseEvent>) -> Result<()> {
    windows::start_global_mouse_hook(callback)
}

#[cfg(target_os = "linux")]
#[napi]
pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<KeyEvent>) -> Result<()> {
    linux::start_global_keyboard_hook(callback)
}

#[cfg(target_os = "windows")]
#[napi]
pub fn start_global_keyboard_hook(callback: ThreadsafeFunction<KeyEvent>) -> Result<()> {
    windows::start_global_keyboard_hook(callback)
}

#[napi]
pub fn stop_global_mouse_hook() -> Result<()> {
    // TODO: реализовать остановку хуков через канал или флаг
    Ok(())
}

#[napi]
pub fn stop_global_keyboard_hook() -> Result<()> {
    // TODO: реализовать остановку хуков
    Ok(())
}