use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;

const HIDDEN_ARG: &str = "--hidden";
const OVERLAY_LABEL: &str = "overlay";

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
async fn ensure_overlay(app: AppHandle) -> Result<bool, String> {
  if app.get_webview_window(OVERLAY_LABEL).is_some() {
    return Ok(false);
  }
  let config = app
    .config()
    .app
    .windows
    .iter()
    .find(|w| w.label == OVERLAY_LABEL)
    .ok_or("missing overlay window config")?
    .clone();
  WebviewWindowBuilder::from_config(&app, &config)
    .and_then(|builder| builder.build())
    .map_err(|e| e.to_string())?;
  Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![ensure_overlay])
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
    .on_window_event(|window, event| {
      if let WindowEvent::CloseRequested { api, .. } = event {
        if window.label() == "main" {
          api.prevent_close();
          if let Err(error) = window.hide() {
            eprintln!("failed to hide main window: {error}");
          }
        }
      }
    })
    .run(tauri::generate_context!())
    .expect("error while running RyMessage");
}
