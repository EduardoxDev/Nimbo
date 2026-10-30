//! Air conditioners driven by infrared through a Broadlink.
//!
//! Codes come from the SmartIR community library (MIT): the user picks a brand
//! and model, the model's JSON is downloaded once and kept with the config.
//! Infrared is one-way, so the island's idea of the AC state lives here and is
//! sent whole on every change (that is how AC remotes work too).

use crate::broadlink::{self, BroadlinkDevice, Session};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    net::Ipv4Addr,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::Duration,
};
use tauri::{AppHandle, Manager};

const CATALOG_URL: &str = "https://raw.githubusercontent.com/smartHomeHub/SmartIR/master/docs/CLIMATE.md";
const CODES_URL: &str = "https://raw.githubusercontent.com/smartHomeHub/SmartIR/master/codes/climate";
const CONFIG_FILE: &str = "ir-climate.json";
const MAX_DOWNLOAD_BYTES: usize = 3 * 1024 * 1024;
const DISCOVERY_WAIT: Duration = Duration::from_millis(2_500);
const LEARN_WAIT: Duration = Duration::from_secs(25);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IrModel {
    code: u32,
    label: String,
    min_temperature: f64,
    max_temperature: f64,
    precision: f64,
    operation_modes: Vec<String>,
    fan_modes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IrState {
    mode: String,
    last_mode: String,
    temperature: f64,
    fan: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IrConfig {
    device: Option<BroadlinkDevice>,
    model: Option<IrModel>,
    state: Option<IrState>,
    /// The model's SmartIR `commands` object.
    commands: Option<Value>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IrStatus {
    device: Option<BroadlinkDevice>,
    model: Option<IrModel>,
    state: Option<IrState>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IrBrand {
    brand: String,
    models: Vec<IrCatalogEntry>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IrCatalogEntry {
    code: u32,
    models: String,
}

static SESSION: OnceLock<Mutex<Option<(BroadlinkDevice, Session)>>> = OnceLock::new();
static CATALOG: OnceLock<Mutex<Option<Vec<IrBrand>>>> = OnceLock::new();
static CONFIG_LOCK: Mutex<()> = Mutex::new(());

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not find the app data folder: {error}"))?;
    fs::create_dir_all(&dir).map_err(|error| format!("Could not create the app data folder: {error}"))?;
    Ok(dir.join(CONFIG_FILE))
}

fn load_config(app: &AppHandle) -> Result<IrConfig, String> {
    let path = config_path(app)?;
    match fs::read_to_string(&path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|_| "The saved air conditioner setup is damaged; set it up again.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(IrConfig::default()),
        Err(error) => Err(format!("Could not read the air conditioner setup: {error}")),
    }
}

fn save_config(app: &AppHandle, config: &IrConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let raw = serde_json::to_string(config).map_err(|error| error.to_string())?;
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, raw).map_err(|error| format!("Could not save the air conditioner setup: {error}"))?;
    fs::rename(&temporary, &path).map_err(|error| format!("Could not save the air conditioner setup: {error}"))
}

fn status_of(config: &IrConfig) -> IrStatus {
    IrStatus {
        device: config.device.clone(),
        model: config.model.clone(),
        state: config.state.clone(),
    }
}

/// Runs `operation` on a live session, reconnecting once if the old one went stale.
fn with_session<T>(device: &BroadlinkDevice, operation: impl Fn(&mut Session) -> Result<T, String>) -> Result<T, String> {
    let lock = SESSION.get_or_init(|| Mutex::new(None));
    let mut guard = lock.lock().map_err(|_| "The Broadlink connection is busy.".to_string())?;
    if let Some((known, session)) = guard.as_mut() {
        if known == device {
            if let Ok(value) = operation(session) {
                return Ok(value);
            }
        }
    }
    let mut session = Session::connect(device)?;
    let value = operation(&mut session)?;
    *guard = Some((device.clone(), session));
    Ok(value)
}

async fn blocking<T: Send + 'static>(job: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(job)
        .await
        .map_err(|error| format!("Background task failed: {error}"))?
}

async fn download(url: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not download the code library: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The code library is unavailable: {error}"))?;
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_DOWNLOAD_BYTES {
        return Err("The downloaded file is too large.".to_string());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "The downloaded file is not text.".to_string())
}

/// Reads the brand tables of SmartIR's CLIMATE.md, keeping Broadlink rows only.
fn parse_catalog(markdown: &str) -> Vec<IrBrand> {
    let mut brands: Vec<IrBrand> = Vec::new();
    for line in markdown.lines() {
        let line = line.trim();
        if let Some(brand) = line.strip_prefix("#### ") {
            brands.push(IrBrand { brand: brand.trim().to_string(), models: Vec::new() });
            continue;
        }
        let Some(current) = brands.last_mut() else { continue };
        let cells: Vec<&str> = line.trim_matches('|').split('|').map(str::trim).collect();
        if cells.len() < 3 || !cells[2].eq_ignore_ascii_case("broadlink") {
            continue;
        }
        // "[1001](../codes/climate/1000.json)": the link names the real file.
        let Some(file) = cells[0]
            .split("climate/")
            .nth(1)
            .and_then(|rest| rest.split('.').next())
            .and_then(|number| number.parse::<u32>().ok())
        else {
            continue;
        };
        let models = strip_markup(cells[1]);
        current.models.push(IrCatalogEntry { code: file, models });
    }
    brands.retain(|brand| !brand.models.is_empty());
    brands.sort_by_key(|brand| brand.brand.to_lowercase());
    brands
}

fn strip_markup(cell: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for ch in cell.replace("<br>", ", ").replace("<br/>", ", ").chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => text.push(ch),
            _ => {}
        }
    }
    let joined = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let cleaned = joined.trim_matches(|ch: char| ch == ',' || ch.is_whitespace()).to_string();
    if cleaned.is_empty() { "Unknown model".to_string() } else { cleaned }
}

/// Checks a SmartIR climate file and pulls out what the island needs.
fn parse_model(code: u32, label: &str, raw: &str) -> Result<(IrModel, Value), String> {
    let json: Value = serde_json::from_str(raw).map_err(|_| "This model's file could not be read.".to_string())?;
    let field = |key: &str| json.get(key);
    if field("supportedController").and_then(Value::as_str) != Some("Broadlink")
        || field("commandsEncoding").and_then(Value::as_str) != Some("Base64")
    {
        return Err("This model's codes are not for a Broadlink.".to_string());
    }
    let commands = field("commands").filter(|value| value.is_object()).cloned()
        .ok_or_else(|| "This model's file has no commands.".to_string())?;
    let strings = |key: &str| -> Vec<String> {
        field(key)
            .and_then(Value::as_array)
            .map(|items| items.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default()
    };
    let operation_modes: Vec<String> = strings("operationModes")
        .into_iter()
        .filter(|mode| mode != "off" && commands.get(mode).is_some())
        .collect();
    if operation_modes.is_empty() {
        return Err("This model's file has no usable modes.".to_string());
    }
    let model = IrModel {
        code,
        label: label.trim().chars().take(120).collect(),
        min_temperature: field("minTemperature").and_then(Value::as_f64).unwrap_or(16.0),
        max_temperature: field("maxTemperature").and_then(Value::as_f64).unwrap_or(30.0),
        precision: field("precision").and_then(Value::as_f64).filter(|value| *value > 0.0).unwrap_or(1.0),
        operation_modes,
        fan_modes: strings("fanModes"),
    };
    Ok((model, commands))
}

fn temperature_key(value: f64) -> String {
    if (value.fract()).abs() < f64::EPSILON {
        format!("{}", value as i64)
    } else {
        format!("{value:.1}")
    }
}

/// Finds the code for a state: `off`, or `commands[mode][fan][(swing)][temperature]`.
fn code_for(commands: &Value, state: &IrState) -> Option<String> {
    if state.mode == "off" {
        return commands.get("off").and_then(Value::as_str).map(str::to_string);
    }
    let mut node = commands.get(&state.mode)?;
    if !state.fan.is_empty() {
        if let Some(next) = node.get(&state.fan) {
            node = next;
        }
    }
    let key = temperature_key(state.temperature);
    if let Some(code) = node.get(&key).and_then(Value::as_str) {
        return Some(code.to_string());
    }
    // Files with swing modes nest one more level; take the first swing setting.
    node.as_object()?
        .values()
        .find_map(|swing| swing.get(&key).and_then(Value::as_str))
        .map(str::to_string)
}

fn default_state(model: &IrModel) -> IrState {
    let first_mode = model
        .operation_modes
        .iter()
        .find(|mode| *mode == "cool")
        .or_else(|| model.operation_modes.first())
        .cloned()
        .unwrap_or_else(|| "cool".to_string());
    IrState {
        mode: "off".to_string(),
        last_mode: first_mode,
        temperature: 24.0_f64.clamp(model.min_temperature, model.max_temperature),
        fan: model
            .fan_modes
            .iter()
            .find(|fan| *fan == "auto")
            .or_else(|| model.fan_modes.first())
            .cloned()
            .unwrap_or_default(),
    }
}

/// Applies a Home-style service call to the saved state.
fn next_state(model: &IrModel, current: &IrState, service: &str, value: Option<&Value>) -> Result<IrState, String> {
    let mut next = current.clone();
    match service {
        "set_hvac_mode" => {
            let mode = value.and_then(Value::as_str).ok_or("Missing mode.")?;
            if mode != "off" && !model.operation_modes.iter().any(|known| known == mode) {
                return Err("This air conditioner does not have that mode.".to_string());
            }
            if mode != "off" {
                next.last_mode = mode.to_string();
            }
            next.mode = mode.to_string();
        }
        "set_temperature" => {
            let wanted = value.and_then(Value::as_f64).ok_or("Missing temperature.")?;
            let stepped = (wanted / model.precision).round() * model.precision;
            next.temperature = stepped.clamp(model.min_temperature, model.max_temperature);
        }
        "set_fan_mode" => {
            let fan = value.and_then(Value::as_str).ok_or("Missing fan speed.")?;
            if !model.fan_modes.iter().any(|known| known == fan) {
                return Err("This air conditioner does not have that fan speed.".to_string());
            }
            next.fan = fan.to_string();
        }
        "turn_on" => next.mode = next.last_mode.clone(),
        "turn_off" => next.mode = "off".to_string(),
        _ => return Err("This action is not available for infrared.".to_string()),
    }
    Ok(next)
}

#[tauri::command]
pub(crate) fn ir_status(app: AppHandle) -> Result<IrStatus, String> {
    Ok(status_of(&load_config(&app)?))
}

#[tauri::command]
pub(crate) async fn ir_discover(target: Option<String>) -> Result<Vec<BroadlinkDevice>, String> {
    let target = match target.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        Some(text) => Some(text.parse::<Ipv4Addr>().map_err(|_| "Type an address like 192.168.0.50".to_string())?),
        None => None,
    };
    blocking(move || broadlink::discover(target, DISCOVERY_WAIT)).await
}

#[tauri::command]
pub(crate) async fn ir_select_device(app: AppHandle, device: BroadlinkDevice) -> Result<IrStatus, String> {
    let checked = device.clone();
    blocking(move || with_session(&checked, |_| Ok(()))).await?;
    let _guard = CONFIG_LOCK.lock().map_err(|_| "Busy, try again.".to_string())?;
    let mut config = load_config(&app)?;
    config.device = Some(device);
    save_config(&app, &config)?;
    Ok(status_of(&config))
}

#[tauri::command]
pub(crate) fn ir_forget(app: AppHandle) -> Result<IrStatus, String> {
    let _guard = CONFIG_LOCK.lock().map_err(|_| "Busy, try again.".to_string())?;
    let config = IrConfig::default();
    save_config(&app, &config)?;
    Ok(status_of(&config))
}

#[tauri::command]
pub(crate) async fn ir_catalog() -> Result<Vec<IrBrand>, String> {
    let cache = CATALOG.get_or_init(|| Mutex::new(None));
    if let Some(brands) = cache.lock().ok().and_then(|guard| guard.clone()) {
        return Ok(brands);
    }
    let brands = parse_catalog(&download(CATALOG_URL).await?);
    if brands.is_empty() {
        return Err("The code library came back empty.".to_string());
    }
    if let Ok(mut guard) = cache.lock() {
        *guard = Some(brands.clone());
    }
    Ok(brands)
}

#[tauri::command]
pub(crate) async fn ir_select_model(app: AppHandle, code: u32, label: String) -> Result<IrStatus, String> {
    if code == 0 || code > 99_999 {
        return Err("Unknown model.".to_string());
    }
    let raw = download(&format!("{CODES_URL}/{code}.json")).await?;
    let (model, commands) = parse_model(code, &label, &raw)?;
    let _guard = CONFIG_LOCK.lock().map_err(|_| "Busy, try again.".to_string())?;
    let mut config = load_config(&app)?;
    config.state = Some(default_state(&model));
    config.model = Some(model);
    config.commands = Some(commands);
    save_config(&app, &config)?;
    Ok(status_of(&config))
}

/// Changes the AC (mode, temperature, fan, on/off) and sends the matching code.
#[tauri::command]
pub(crate) async fn ir_apply(app: AppHandle, service: String, value: Option<Value>) -> Result<IrStatus, String> {
    let config = load_config(&app)?;
    let (Some(device), Some(model), Some(commands)) = (config.device.clone(), config.model.clone(), config.commands.clone()) else {
        return Err("Set up the Broadlink and the air conditioner model first.".to_string());
    };
    let current = config.state.clone().unwrap_or_else(|| default_state(&model));
    let next = next_state(&model, &current, &service, value.as_ref())?;

    // Changing the temperature while off is remembered, not sent: any code would turn it on.
    if !(next.mode == "off" && current.mode == "off") {
        let code = code_for(&commands, &next)
            .ok_or_else(|| "This model has no code for that setting.".to_string())?;
        let bytes = BASE64.decode(code.trim()).map_err(|_| "This model's code is damaged.".to_string())?;
        let power_on = (current.mode == "off" && next.mode != "off")
            .then(|| commands.get("on").and_then(Value::as_str).and_then(|on| BASE64.decode(on.trim()).ok()))
            .flatten();
        blocking(move || {
            with_session(&device, |session| {
                if let Some(on) = &power_on {
                    session.send_code(on)?;
                    std::thread::sleep(Duration::from_millis(500));
                }
                session.send_code(&bytes)
            })
        })
        .await?;
    }

    let _guard = CONFIG_LOCK.lock().map_err(|_| "Busy, try again.".to_string())?;
    let mut fresh = load_config(&app)?;
    fresh.state = Some(next);
    save_config(&app, &fresh)?;
    Ok(status_of(&fresh))
}

/// Waits for a remote button press on the Broadlink and returns its code (Base64).
#[tauri::command]
pub(crate) async fn ir_learn(app: AppHandle) -> Result<String, String> {
    let device = load_config(&app)?
        .device
        .ok_or_else(|| "Set up the Broadlink first.".to_string())?;
    let code = blocking(move || with_session(&device, |session| session.learn(LEARN_WAIT))).await?;
    Ok(BASE64.encode(code))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const SAMPLE: &str = r#"{
        "manufacturer": "Elgin",
        "supportedController": "Broadlink",
        "commandsEncoding": "Base64",
        "minTemperature": 17,
        "maxTemperature": 30,
        "precision": 1,
        "operationModes": ["cool", "heat", "fan_only"],
        "fanModes": ["low", "high", "auto"],
        "commands": {
            "off": "b2Zm",
            "cool": { "auto": { "22": "Y29vbDIy", "23": "Y29vbDIz" }, "low": { "22": "bG93MjI=" } },
            "heat": { "auto": { "25": "aGVhdDI1" } },
            "fan_only": { "auto": { "swing": { "22": "ZmFu" } } }
        }
    }"#;

    #[test]
    fn catalog_keeps_broadlink_rows_and_real_file_numbers() {
        let markdown = "#### Toyotomi\n| Code | Supported Models | Controller |\n| --- | --- | --- |\n\
            | [1000](../codes/climate/1000.json) | AKIRA GAN/GAG-A128 VL | Broadlink  |\n\
            | [1001](../codes/climate/1000.json) | AKIRA A135FW ML | Broadlink |\n\
            #### Elgin\n| [7000](../codes/climate/7000.json) | Eco | ESPHome |\n\
            | [1860](../codes/climate/1860.json) | Eco Inverter<br>HVFI12 <b>(Swing)</b> | Broadlink |\n";
        let brands = parse_catalog(markdown);
        assert_eq!(brands.len(), 2);
        assert_eq!(brands[0].brand, "Elgin");
        assert_eq!(brands[0].models.len(), 1);
        assert_eq!(brands[0].models[0].code, 1860);
        assert_eq!(brands[0].models[0].models, "Eco Inverter, HVFI12 (Swing)");
        assert_eq!(brands[1].models[1].code, 1000);
    }

    #[test]
    fn models_are_validated_and_summarized() {
        let (model, commands) = parse_model(1860, "Elgin Eco", SAMPLE).unwrap();
        assert_eq!(model.operation_modes, vec!["cool", "heat", "fan_only"]);
        assert_eq!(model.min_temperature, 17.0);
        assert!(commands.get("off").is_some());
        let esphome = SAMPLE.replace("\"Broadlink\"", "\"ESPHome\"");
        assert!(parse_model(1, "x", &esphome).is_err());
        assert!(parse_model(1, "x", "not json").is_err());
    }

    #[test]
    fn codes_are_found_for_each_kind_of_state() {
        let (model, commands) = parse_model(1860, "Elgin Eco", SAMPLE).unwrap();
        let mut state = default_state(&model);
        assert_eq!(state.mode, "off");
        assert_eq!(state.fan, "auto");
        assert_eq!(code_for(&commands, &state).as_deref(), Some("b2Zm"));
        state = next_state(&model, &state, "turn_on", None).unwrap();
        state = next_state(&model, &state, "set_temperature", Some(&json!(22.4))).unwrap();
        assert_eq!(state.mode, "cool");
        assert_eq!(state.temperature, 22.0);
        assert_eq!(code_for(&commands, &state).as_deref(), Some("Y29vbDIy"));
        state = next_state(&model, &state, "set_fan_mode", Some(&json!("low"))).unwrap();
        assert_eq!(code_for(&commands, &state).as_deref(), Some("bG93MjI="));
        state = next_state(&model, &state, "set_hvac_mode", Some(&json!("fan_only"))).unwrap();
        state.fan = "auto".to_string();
        assert_eq!(code_for(&commands, &state).as_deref(), Some("ZmFu"));
        assert!(next_state(&model, &state, "set_hvac_mode", Some(&json!("dry"))).is_err());
        assert!(next_state(&model, &state, "set_temperature", Some(&json!(99))).unwrap().temperature == 30.0);
        assert!(next_state(&model, &state, "explode", None).is_err());
    }
}
