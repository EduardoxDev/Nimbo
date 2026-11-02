//! "Why is my PC slow?": a one-second checkup of CPU, memory and disk, with the
//! apps that use the most (all of Chrome's processes count as one Chrome).
//! Closing an app only happens when the user clicks, and asks it to close
//! politely (like the window's X), never by force.

use serde::Serialize;
use std::{collections::HashMap, os::windows::process::CommandExt, process::Command, thread, time::Duration};
use windows::{
    core::HSTRING,
    Win32::{
        Foundation::{CloseHandle, FILETIME},
        Storage::FileSystem::GetDiskFreeSpaceExW,
        System::{
            Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS},
            ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
            SystemInformation::{GetSystemInfo, GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX, SYSTEM_INFO},
            Threading::{GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION},
        },
    },
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const SAMPLE: Duration = Duration::from_millis(800);
/// Never offered for closing: Windows itself and the Nimbo.
const PROTECTED: [&str; 14] = [
    "system", "idle", "registry", "smss", "csrss", "wininit", "winlogon", "services", "lsass", "svchost", "dwm", "explorer", "nimbo", "memory compression",
];

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppUse {
    name: String,
    processes: usize,
    memory_mb: u64,
    /// Share of the whole CPU, 0..100.
    cpu: f64,
    can_close: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Checkup {
    cpu: f64,
    memory_used: f64,
    memory_total_gb: f64,
    disk_free_gb: f64,
    disk_total_gb: f64,
    uptime_hours: f64,
    apps: Vec<AppUse>,
}

struct Sample {
    name: String,
    cpu_time: u64,
    memory: u64,
}

fn ticks(time: FILETIME) -> u64 {
    (u64::from(time.dwHighDateTime) << 32) | u64::from(time.dwLowDateTime)
}

fn processes() -> HashMap<u32, Sample> {
    let mut found = HashMap::new();
    unsafe {
        let Ok(snapshot) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return found };
        let mut entry = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snapshot, &mut entry).is_ok();
        while ok {
            let length = entry.szExeFile.iter().position(|unit| *unit == 0).unwrap_or(entry.szExeFile.len());
            let name = String::from_utf16_lossy(&entry.szExeFile[..length]);
            if let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, entry.th32ProcessID) {
                let (mut created, mut exited, mut kernel, mut user) = Default::default();
                let cpu_time = if GetProcessTimes(process, &mut created, &mut exited, &mut kernel, &mut user).is_ok() { ticks(kernel) + ticks(user) } else { 0 };
                let mut counters = PROCESS_MEMORY_COUNTERS { cb: std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32, ..Default::default() };
                let memory = if K32GetProcessMemoryInfo(process, &mut counters, counters.cb).as_bool() { counters.WorkingSetSize as u64 } else { 0 };
                let _ = CloseHandle(process);
                found.insert(entry.th32ProcessID, Sample { name, cpu_time, memory });
            }
            ok = Process32NextW(snapshot, &mut entry).is_ok();
        }
        let _ = CloseHandle(snapshot);
    }
    found
}

/// "chrome.exe" → "chrome"; Windows' own processes cannot be closed from here.
pub(crate) fn app_key(exe: &str) -> String {
    exe.trim_end_matches(".exe").trim_end_matches(".EXE").to_lowercase()
}

pub(crate) fn closable(key: &str) -> bool {
    !PROTECTED.contains(&key)
}

#[tauri::command]
pub(crate) async fn pc_checkup() -> Result<Checkup, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let first = processes();
        thread::sleep(SAMPLE);
        let second = processes();
        let mut info = SYSTEM_INFO::default();
        unsafe { GetSystemInfo(&mut info) };
        let cores = f64::from(info.dwNumberOfProcessors.max(1));
        // 100 ns ticks of CPU time over the sample, across all cores.
        let budget = SAMPLE.as_nanos() as f64 / 100.0 * cores;

        let mut apps: HashMap<String, AppUse> = HashMap::new();
        let mut busy = 0.0;
        for (pid, now) in &second {
            let used = first.get(pid).filter(|before| before.name == now.name).map(|before| now.cpu_time.saturating_sub(before.cpu_time)).unwrap_or(0) as f64;
            let key = app_key(&now.name);
            if key == "idle" || key == "system idle process" {
                continue;
            }
            busy += used;
            let entry = apps.entry(key.clone()).or_insert(AppUse { name: key.clone(), processes: 0, memory_mb: 0, cpu: 0.0, can_close: closable(&key) });
            entry.processes += 1;
            entry.memory_mb += now.memory / (1024 * 1024);
            entry.cpu += used / budget * 100.0;
        }
        let mut apps: Vec<AppUse> = apps.into_values().filter(|app| app.memory_mb >= 50 || app.cpu >= 2.0).collect();
        apps.sort_by(|a, b| (b.cpu * 40.0 + b.memory_mb as f64).total_cmp(&(a.cpu * 40.0 + a.memory_mb as f64)));
        apps.truncate(6);
        for app in &mut apps {
            app.cpu = (app.cpu * 10.0).round() / 10.0;
        }

        let mut memory = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
        unsafe { GlobalMemoryStatusEx(&mut memory) }.map_err(|error| error.to_string())?;
        let gib = 1024.0 * 1024.0 * 1024.0;
        let (mut free, mut total) = (0u64, 0u64);
        let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".to_string());
        unsafe {
            let _ = GetDiskFreeSpaceExW(&HSTRING::from(format!("{drive}\\")), Some(&mut free), Some(&mut total), None);
        }
        let round = |value: f64| (value * 10.0).round() / 10.0;
        Ok(Checkup {
            cpu: round((busy / budget * 100.0).min(100.0)),
            memory_used: f64::from(memory.dwMemoryLoad),
            memory_total_gb: round(memory.ullTotalPhys as f64 / gib),
            disk_free_gb: round(free as f64 / gib),
            disk_total_gb: round(total as f64 / gib),
            uptime_hours: round(unsafe { GetTickCount64() } as f64 / 3_600_000.0),
            apps,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Asks every window of an app to close, like clicking its X (unsaved work still asks first).
#[tauri::command]
pub(crate) fn pc_close_app(name: String) -> Result<(), String> {
    let key = app_key(&name);
    if !closable(&key) || key.is_empty() || !key.chars().all(|c| c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ')) {
        return Err("Esse programa é do Windows e não pode ser fechado por aqui.".to_string());
    }
    let status = Command::new("taskkill.exe").args(["/IM", &format!("{key}.exe")]).creation_flags(CREATE_NO_WINDOW).status().map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("O programa não quis fechar. Feche pela janela dele.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_itself_is_never_offered_for_closing() {
        assert_eq!(app_key("Chrome.EXE"), "chrome");
        assert!(closable("chrome"));
        assert!(!closable("explorer"));
        assert!(!closable("nimbo"));
        assert!(!closable("svchost"));
    }

    /// Real numbers from this PC: `cargo test doctor::tests::checkup -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn checkup_on_this_pc() {
        let result = tauri::async_runtime::block_on(pc_checkup()).expect("checkup");
        println!("cpu {}% mem {}% disk free {} GB up {} h", result.cpu, result.memory_used, result.disk_free_gb, result.uptime_hours);
        for app in result.apps {
            println!("  {} ×{} {} MB {}%", app.name, app.processes, app.memory_mb, app.cpu);
        }
    }
}
