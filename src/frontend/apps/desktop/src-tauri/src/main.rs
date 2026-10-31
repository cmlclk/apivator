// Windows'ta release derlemesinde ek konsol penceresi açılmasın.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    apivator_desktop_lib::run()
}
