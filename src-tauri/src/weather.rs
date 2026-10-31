use reqwest::Url;
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const GEOCODING_URL: &str = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL: &str = "https://api.open-meteo.com/v1/forecast";

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Place {
    name: String,
    region: String,
    latitude: f64,
    longitude: f64,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Weather {
    temperature: f64,
    code: i64,
    is_day: bool,
    max: Option<f64>,
    min: Option<f64>,
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())
}

async fn get_json(url: Url) -> Result<Value, String> {
    let response = client()?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach the weather service: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Weather service returned HTTP {}.", response.status()));
    }
    response.json().await.map_err(|error| error.to_string())
}

fn parse_places(body: &Value) -> Vec<Place> {
    body.get("results")
        .and_then(Value::as_array)
        .map(|results| {
            results
                .iter()
                .filter_map(|result| {
                    let region = [result.get("admin1"), result.get("country")]
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .collect::<Vec<_>>()
                        .join(", ");
                    Some(Place {
                        name: result.get("name")?.as_str()?.to_string(),
                        region,
                        latitude: result.get("latitude")?.as_f64()?,
                        longitude: result.get("longitude")?.as_f64()?,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn parse_weather(body: &Value) -> Option<Weather> {
    let current = body.get("current")?;
    let first = |key: &str| {
        body.get("daily")
            .and_then(|daily| daily.get(key))
            .and_then(Value::as_array)
            .and_then(|values| values.first())
            .and_then(Value::as_f64)
    };
    Some(Weather {
        temperature: current.get("temperature_2m")?.as_f64()?,
        code: current.get("weather_code")?.as_i64()?,
        is_day: current.get("is_day").and_then(Value::as_i64).unwrap_or(1) == 1,
        max: first("temperature_2m_max"),
        min: first("temperature_2m_min"),
    })
}

fn valid_coordinates(latitude: f64, longitude: f64) -> bool {
    (-90.0..=90.0).contains(&latitude) && (-180.0..=180.0).contains(&longitude)
}

#[tauri::command]
pub(crate) async fn weather_search(query: String, language: String) -> Result<Vec<Place>, String> {
    let query = query.trim();
    if query.chars().count() < 2 {
        return Ok(Vec::new());
    }
    let language = if matches!(language.as_str(), "pt" | "en" | "zh") { language } else { "en".to_string() };
    let query: String = query.chars().take(80).collect();
    let url = Url::parse_with_params(
        GEOCODING_URL,
        &[("name", query.as_str()), ("count", "6"), ("language", language.as_str()), ("format", "json")],
    )
    .map_err(|error| error.to_string())?;
    Ok(parse_places(&get_json(url).await?))
}

#[tauri::command]
pub(crate) async fn weather_current(latitude: f64, longitude: f64) -> Result<Weather, String> {
    if !valid_coordinates(latitude, longitude) {
        return Err("Invalid location.".to_string());
    }
    let latitude = format!("{latitude:.4}");
    let longitude = format!("{longitude:.4}");
    let url = Url::parse_with_params(
        FORECAST_URL,
        &[
            ("latitude", latitude.as_str()),
            ("longitude", longitude.as_str()),
            ("current", "temperature_2m,weather_code,is_day"),
            ("daily", "temperature_2m_max,temperature_2m_min"),
            ("timezone", "auto"),
            ("forecast_days", "1"),
        ],
    )
    .map_err(|error| error.to_string())?;
    parse_weather(&get_json(url).await?).ok_or_else(|| "The weather service sent an unexpected answer.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn places_include_region_and_country() {
        let body = json!({"results": [{"name": "São Paulo", "admin1": "São Paulo", "country": "Brasil", "latitude": -23.55, "longitude": -46.63}, {"name": "broken"}]});
        let places = parse_places(&body);
        assert_eq!(places.len(), 1);
        assert_eq!(places[0].region, "São Paulo, Brasil");
        assert!(parse_places(&json!({})).is_empty());
    }

    #[test]
    fn current_weather_reads_today_range() {
        let body = json!({"current": {"temperature_2m": 24.3, "weather_code": 2, "is_day": 0}, "daily": {"temperature_2m_max": [28.1], "temperature_2m_min": [18.0]}});
        let weather = parse_weather(&body).unwrap();
        assert_eq!(weather.code, 2);
        assert!(!weather.is_day);
        assert_eq!(weather.max, Some(28.1));
        assert!(parse_weather(&json!({"daily": {}})).is_none());
    }

    #[test]
    fn coordinates_are_checked() {
        assert!(valid_coordinates(-23.5, -46.6));
        assert!(!valid_coordinates(91.0, 0.0));
    }
}
