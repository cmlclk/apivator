//! İlk açılışta ana pencereyi ekranın çalışma alanına (görev çubuğu hariç) sığdırır ve ortalar. Varsayılan boyut
//! (1440×900) küçük ya da ölçeklenmiş ekranlarda taşıyordu; pencere gizli açılır, yerleştirilince gösterilir.

use tauri::{PhysicalPosition, PhysicalSize, WebviewWindow};

/// Varsayılan (mantıksal) boyut ve çalışma alanının en çok bu oranı.
const DEFAULT: (f64, f64) = (1440.0, 900.0);
const MAX_SHARE: f64 = 0.92;

/// Çalışma alanına göre iç boyut: varsayılanı aşmaz, alanın %92'sini aşmaz.
pub fn fitted_size(work: (u32, u32), scale: f64) -> (u32, u32) {
    let fit = |default: f64, available: u32| {
        (default * scale)
            .min(f64::from(available) * MAX_SHARE)
            .round() as u32
    };
    (fit(DEFAULT.0, work.0), fit(DEFAULT.1, work.1))
}

/// Dış boyutu verilen pencereyi çalışma alanında ortalayan sol üst köşe.
pub fn centered(work_pos: (i32, i32), work: (u32, u32), outer: (u32, u32)) -> (i32, i32) {
    let offset = |area: u32, size: u32| (i64::from(area) - i64::from(size)).max(0) as i32 / 2;
    (
        work_pos.0 + offset(work.0, outer.0),
        work_pos.1 + offset(work.1, outer.1),
    )
}

pub fn fit_and_show(window: &WebviewWindow) {
    if let Ok(Some(monitor)) = window
        .current_monitor()
        .or_else(|_| window.primary_monitor())
    {
        let area = monitor.work_area();
        let work = (area.size.width, area.size.height);
        let (width, height) = fitted_size(work, monitor.scale_factor());
        let _ = window.set_size(PhysicalSize::new(width, height));
        // Başlık çubuğu dahil dış boyutla ortalanır.
        let outer = window
            .outer_size()
            .map(|s| (s.width, s.height))
            .unwrap_or((width, height));
        let (x, y) = centered((area.position.x, area.position.y), work, outer);
        let _ = window.set_position(PhysicalPosition::new(x, y));
    }
    let _ = window.show();
    let _ = window.set_focus();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_default_size_on_large_screens() {
        assert_eq!(fitted_size((2560, 1400), 1.0), (1440, 900));
        assert_eq!(fitted_size((3840, 2100), 2.0), (2880, 1800));
    }

    #[test]
    fn shrinks_to_the_work_area_on_small_or_scaled_screens() {
        // 1920×1080, %125 ölçek, görev çubuğu 48 px: 1440×900 mantıksal = 1800×1125 fiziksel sığmaz.
        assert_eq!(fitted_size((1920, 1032), 1.25), (1766, 949));
        assert_eq!(fitted_size((1366, 728), 1.0), (1257, 670));
    }

    #[test]
    fn centers_within_the_work_area() {
        assert_eq!(centered((0, 0), (1920, 1032), (1766, 979)), (77, 26));
        // İkinci monitör ve pencere alandan büyükse sol üste yaslanır.
        assert_eq!(centered((1920, 0), (1000, 700), (1200, 800)), (1920, 0));
    }
}
