use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, State, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

const HIDDEN_ARG: &str = "--hidden";
const OVERLAY_LABEL: &str = "overlay";
const NOTICE_EVENT: &str = "overlay-notice";
const CLEAR_EVENT: &str = "overlay-clear";
const UPDATE_EVENT: &str = "overlay-update";

#[derive(Default)]
struct OverlayState {
  building: bool,
  ready: bool,
  pending: Vec<serde_json::Value>,
}

fn show_main(app: &AppHandle) {
  let Some(window) = app.get_webview_window("main") else {
    return;
  };
  for result in [window.show(), window.unminimize(), window.set_focus()] {
    if let Err(error) = result {
      eprintln!("failed to show main window: {error}");
    }
  }
}

// an overlay built during login never reaches the screen, so build it on first use; async because sync window creation deadlocks on Windows
#[tauri::command]
async fn post_overlay_notice(
  app: AppHandle,
  state: State<'_, Mutex<OverlayState>>,
  notice: serde_json::Value,
) -> Result<(), String> {
  let should_build = {
    let mut guard = state.lock().unwrap();
    let exists = app.get_webview_window(OVERLAY_LABEL).is_some();
    if !exists {
      guard.ready = false;
    }
    if exists && guard.ready {
      false
    } else {
      guard.pending.push(notice.clone());
      if !exists && !guard.building {
        guard.building = true;
        true
      } else {
        return Ok(());
      }
    }
  };
  if !should_build {
    return app
      .emit_to(OVERLAY_LABEL, NOTICE_EVENT, notice)
      .map_err(|e| e.to_string());
  }
  let built = app
    .config()
    .app
    .windows
    .iter()
    .find(|w| w.label == OVERLAY_LABEL)
    .cloned()
    .ok_or_else(|| "missing overlay window config".to_string())
    .and_then(|config| {
      WebviewWindowBuilder::from_config(&app, &config)
        .and_then(|builder| builder.build())
        .map_err(|e| e.to_string())
    });
  let mut guard = state.lock().unwrap();
  guard.building = false;
  if let Err(err) = built {
    guard.pending.clear();
    return Err(err);
  }
  Ok(())
}

#[tauri::command]
fn overlay_ready(state: State<'_, Mutex<OverlayState>>) -> Vec<serde_json::Value> {
  let mut guard = state.lock().unwrap();
  guard.ready = true;
  std::mem::take(&mut guard.pending)
}

#[tauri::command]
fn clear_overlay(app: AppHandle, state: State<'_, Mutex<OverlayState>>) -> Result<(), String> {
  let ready = {
    let mut guard = state.lock().unwrap();
    guard.pending.clear();
    guard.ready && app.get_webview_window(OVERLAY_LABEL).is_some()
  };
  if ready {
    app
      .emit_to(OVERLAY_LABEL, CLEAR_EVENT, ())
      .map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn update_overlay(
  app: AppHandle,
  state: State<'_, Mutex<OverlayState>>,
  message: serde_json::Value,
) -> Result<(), String> {
  let ready = {
    let mut guard = state.lock().unwrap();
    if let Some(id) = message.get("id").and_then(|v| v.as_str()) {
      let unsent = message.get("unsent").and_then(|v| v.as_bool()) == Some(true);
      if unsent {
        guard.pending.retain(|n| {
          n.get("message")
            .and_then(|m| m.get("id"))
            .and_then(|v| v.as_str())
            != Some(id)
        });
      } else {
        for notice in &mut guard.pending {
          let matches = notice
            .get("message")
            .and_then(|m| m.get("id"))
            .and_then(|v| v.as_str())
            == Some(id);
          if matches {
            if let Some(obj) = notice.as_object_mut() {
              obj.insert("message".to_string(), message.clone());
            }
          }
        }
      }
    }
    guard.ready && app.get_webview_window(OVERLAY_LABEL).is_some()
  };
  if ready {
    app
      .emit_to(OVERLAY_LABEL, UPDATE_EVENT, message)
      .map_err(|e| e.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn sync_overlay_window(app: AppHandle, width: f64, height: f64) -> Result<(), String> {
  let Some(window) = app.get_webview_window(OVERLAY_LABEL) else {
    return Ok(());
  };
  if height <= 0.0 {
    return window.hide().map_err(|e| e.to_string());
  }
  window
    .set_size(LogicalSize::new(width, height))
    .map_err(|e| e.to_string())?;
  window.show().map_err(|e| e.to_string())?;
  let _ = window.set_always_on_top(true);
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(Mutex::new(OverlayState::default()))
    .invoke_handler(tauri::generate_handler![
      post_overlay_notice,
      overlay_ready,
      clear_overlay,
      update_overlay,
      sync_overlay_window,
    ])
    .plugin(tauri_plugin_autostart::init(
      MacosLauncher::LaunchAgent,
      Some(vec![HIDDEN_ARG]),
    ))
    .plugin(tauri_plugin_clipboard_manager::init())
    .setup(|app| {
      let open = MenuItem::with_id(app, "open", "Open RyMessage", true, None::<&str>)?;
      let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
      let menu = Menu::with_items(app, &[&open, &quit])?;
      let icon = app.default_window_icon().cloned().ok_or("missing app icon")?;
      TrayIconBuilder::new()
        .icon(icon)
        .tooltip("RyMessage")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
          "open" => show_main(app),
          "quit" => app.exit(0),
          _ => {}
        })
        .on_tray_icon_event(|tray, event| {
          if let TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
          } = event
          {
            show_main(tray.app_handle());
          }
        })
        .build(app)?;
      if !std::env::args().any(|arg| arg == HIDDEN_ARG) {
        show_main(app.handle());
      }
      Ok(())
    })
    .on_window_event(|window, event| match event {
      WindowEvent::CloseRequested { api, .. } => {
        if window.label() == "main" || window.label() == OVERLAY_LABEL {
          api.prevent_close();
          if let Err(error) = window.hide() {
            eprintln!("failed to hide {} window: {error}", window.label());
          }
        }
      }
      WindowEvent::Destroyed => {
        if window.label() == OVERLAY_LABEL {
          let state = window.state::<Mutex<OverlayState>>();
          let mut guard = state.lock().unwrap();
          guard.ready = false;
          guard.building = false;
        }
      }
      _ => {}
    })
    .run(tauri::generate_context!())
    .expect("error while running RyMessage");
}
