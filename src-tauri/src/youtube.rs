//! Free, whole songs for Nimbo Music through YouTube's official embedded
//! player. This module only finds the right video for a song; the page plays
//! it with the IFrame Player API, visible on screen as YouTube requires.
//!
//! Finding the video needs no setup: Nimbo reads YouTube's public search page,
//! the same one anyone sees in a browser. A YouTube Data API key is optional
//! (pasted in Settings, kept in Windows Credential Manager, or built in with
//! `NIMBO_YOUTUBE_KEY`); when present it is tried first.

use keyring::{Entry, Error as KeyringError};
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const CREDENTIAL_SERVICE: &str = "com.nimbo.app.youtube";
const CREDENTIAL_USER: &str = "api-key";
const API: &str = "https://www.googleapis.com/youtube/v3";
const TIMEOUT: Duration = Duration::from_secs(10);
const BUILT_IN_KEY: Option<&str> = option_env!("NIMBO_YOUTUBE_KEY");
const SEARCH_PAGE: &str = "https://www.youtube.com/results";
/// YouTube's own "Type: Video" search filter.
const ONLY_VIDEOS: &str = "EgIQAQ==";
const BROWSER: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct YouTubeStatus {
    configured: bool,
    own_key: bool,
    built_in: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Candidate {
    id: String,
    title: String,
    channel: String,
    seconds: u32,
}

fn credential() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|error| error.to_string())
}

fn own_key() -> Result<Option<String>, String> {
    match credential()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(error) => Err(format!("Could not read Windows Credential Manager: {error}")),
    }
}

fn built_in_key() -> Option<&'static str> {
    BUILT_IN_KEY.filter(|key| !key.trim().is_empty())
}

fn api_key() -> Option<String> {
    own_key().ok().flatten().or_else(|| built_in_key().map(str::to_string))
}

fn valid_key(key: &str) -> bool {
    key.len() == 39 && key.starts_with("AIza") && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[tauri::command]
pub(crate) fn youtube_status() -> Result<YouTubeStatus, String> {
    let own = own_key()?.is_some();
    let built_in = built_in_key().is_some();
    // The public search page always works, so YouTube is ready out of the box.
    Ok(YouTubeStatus { configured: true, own_key: own, built_in })
}

/// Checks the key with one cheap request before keeping it.
#[tauri::command]
pub(crate) async fn youtube_save_key(key: String) -> Result<YouTubeStatus, String> {
    let key = key.trim().to_string();
    if !valid_key(&key) {
        return Err("YT_KEY".into());
    }
    get_json(&key, "/videos", &[("part", "id"), ("id", "kJQP7kiw5Fk")]).await?;
    credential()?
        .set_password(&key)
        .map_err(|error| format!("Could not save to Windows Credential Manager: {error}"))?;
    youtube_status()
}

#[tauri::command]
pub(crate) fn youtube_delete_key() -> Result<YouTubeStatus, String> {
    match credential()?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => youtube_status(),
        Err(error) => Err(format!("Could not remove the key: {error}")),
    }
}

async fn get_json(key: &str, path: &str, params: &[(&str, &str)]) -> Result<Value, String> {
    let mut all: Vec<(&str, &str)> = params.to_vec();
    all.push(("key", key));
    let url = reqwest::Url::parse_with_params(&format!("{API}{path}"), &all)
        .map_err(|error| format!("Could not build the YouTube address: {error}"))?;
    let response = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .build()
        .map_err(|error| format!("Could not start the YouTube client: {error}"))?
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach YouTube: {error}"))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        return Ok(body);
    }
    let reason = body.pointer("/error/errors/0/reason").and_then(Value::as_str).unwrap_or_default();
    Err(match reason {
        "quotaExceeded" | "dailyLimitExceeded" | "rateLimitExceeded" => "YT_QUOTA".into(),
        "keyInvalid" | "keyExpired" | "accessNotConfigured" | "forbidden" | "ipRefererBlocked" => "YT_KEY".into(),
        _ if status.as_u16() == 400 || status.as_u16() == 403 => "YT_KEY".into(),
        _ => format!("YouTube answered {}", status.as_u16()),
    })
}

/// ISO 8601 durations as YouTube writes them: "PT4M42S", "PT1H2M", "PT59S".
fn seconds_of(iso: &str) -> u32 {
    let mut total = 0u32;
    let mut number = 0u32;
    for c in iso.chars() {
        match c {
            '0'..='9' => number = number * 10 + (c as u32 - '0' as u32),
            'H' => {
                total += number * 3600;
                number = 0;
            }
            'M' => {
                total += number * 60;
                number = 0;
            }
            'S' => {
                total += number;
                number = 0;
            }
            _ => number = 0,
        }
    }
    total
}

fn simplify(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            c if c.is_alphanumeric() => c,
            _ => ' ',
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

const UNWANTED: [&str; 9] = ["cover", "karaoke", "instrumental", "remix", "sped up", "slowed", "8d", "reaction", "tutorial"];
const LIVE: [&str; 4] = ["ao vivo", "live", "en vivo", "acustico"];
const AUDIO: [&str; 3] = ["official audio", "audio oficial", "audio"];
/// Below this the first search probably missed; a second, more specific one runs.
const GOOD_ENOUGH: i32 = 70;

/// Higher is better. Official "Artist - Topic" uploads match the album
/// recording exactly, so they win; covers, karaoke and lyric edits lose.
fn score(candidate: &Candidate, title: &str, artist: &str, seconds: u32) -> i32 {
    let video = simplify(&candidate.title);
    let channel = simplify(&candidate.channel);
    let wanted_title = simplify(title);
    let wanted_artist = simplify(artist.split(',').next().unwrap_or(artist));
    let mut points = 0;
    if !wanted_title.is_empty() && video.contains(&wanted_title) {
        points += 40;
    } else {
        let words: Vec<&str> = wanted_title.split(' ').filter(|word| word.len() > 2).collect();
        let hits = words.iter().filter(|word| video.contains(**word)).count();
        if !words.is_empty() {
            points += (25 * hits / words.len()) as i32;
        }
    }
    if !wanted_artist.is_empty() && (channel.contains(&wanted_artist) || video.contains(&wanted_artist)) {
        points += 25;
    }
    if candidate.channel.ends_with(" - Topic") {
        points += 30;
    }
    for word in UNWANTED {
        if video.contains(word) && !wanted_title.contains(word) {
            points -= 40;
        }
    }
    // Studio or live: match what the catalog says the song is.
    let wants_live = LIVE.iter().any(|word| wanted_title.contains(word));
    let is_live = LIVE.iter().any(|word| video.contains(word));
    if wants_live != is_live {
        points -= 18;
    }
    if AUDIO.iter().any(|word| video.contains(word)) {
        points += 10;
    }
    // Lyric and fan uploads often trim or loop the song.
    if ["lyric", "letra", "legendado", "tradução", "traducao"].iter().any(|word| video.contains(word)) {
        points -= 6;
    }
    if seconds > 0 && candidate.seconds > 0 {
        let gap = (candidate.seconds as i32 - seconds as i32).abs();
        points += match gap {
            0..=3 => 30,
            4..=10 => 20,
            11..=25 => 8,
            26..=60 => -10,
            _ => -35,
        };
    }
    points
}

/// The best videos for a song, best first (the page tries the next one if the
/// owner blocks embedding).
#[tauri::command]
pub(crate) async fn youtube_find(title: String, artist: String, seconds: Option<u32>) -> Result<Vec<Candidate>, String> {
    let main_artist = artist.split(',').next().unwrap_or(&artist).trim().to_string();
    let wanted = seconds.unwrap_or(0);
    let mut candidates = search(&format!("{main_artist} {}", title.trim())).await?;
    let best = candidates.iter().map(|candidate| score(candidate, &title, &artist, wanted)).max().unwrap_or(i32::MIN);
    if best < GOOD_ENOUGH {
        // Quoted title plus "audio" pulls the official upload up when the first try missed.
        if let Ok(more) = search(&format!("{main_artist} \"{}\" audio", title.trim())).await {
            for candidate in more {
                if !candidates.iter().any(|known| known.id == candidate.id) {
                    candidates.push(candidate);
                }
            }
        }
    }
    candidates.sort_by_key(|candidate| -score(candidate, &title, &artist, wanted));
    candidates.truncate(5);
    Ok(candidates)
}

/// The Data API when there is a key (falling back on any error), else the public page.
async fn search(query: &str) -> Result<Vec<Candidate>, String> {
    match api_key() {
        Some(key) => match search_with_key(&key, query).await {
            Ok(found) if !found.is_empty() => Ok(found),
            _ => search_page(query).await,
        },
        None => search_page(query).await,
    }
}

/// The Data API route: 101 units of the key's daily quota.
async fn search_with_key(key: &str, query: &str) -> Result<Vec<Candidate>, String> {
    let found = get_json(
        key,
        "/search",
        &[
            ("part", "snippet"),
            ("type", "video"),
            ("maxResults", "8"),
            ("videoEmbeddable", "true"),
            ("videoSyndicated", "true"),
            ("q", query),
        ],
    )
    .await?;
    let ids: Vec<String> = found
        .get("items")
        .and_then(Value::as_array)
        .map(|items| items.iter().filter_map(|item| item.pointer("/id/videoId")?.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let joined = ids.join(",");
    let details = get_json(key, "/videos", &[("part", "snippet,contentDetails,status"), ("id", joined.as_str())]).await?;
    Ok(details
        .get("items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter(|item| item.pointer("/status/embeddable").and_then(Value::as_bool) != Some(false))
                .filter_map(|item| {
                    Some(Candidate {
                        id: item.get("id")?.as_str()?.to_string(),
                        title: item.pointer("/snippet/title")?.as_str()?.to_string(),
                        channel: item.pointer("/snippet/channelTitle").and_then(Value::as_str).unwrap_or_default().to_string(),
                        seconds: seconds_of(item.pointer("/contentDetails/duration").and_then(Value::as_str).unwrap_or_default()),
                    })
                })
                .collect()
        })
        .unwrap_or_default())
}

/// The keyless route: YouTube's public results page, read like a browser does.
async fn search_page(query: &str) -> Result<Vec<Candidate>, String> {
    let url = reqwest::Url::parse_with_params(SEARCH_PAGE, &[("search_query", query), ("sp", ONLY_VIDEOS)])
        .map_err(|error| format!("Could not build the YouTube address: {error}"))?;
    let html = reqwest::Client::builder()
        .timeout(TIMEOUT)
        .user_agent(BROWSER)
        .build()
        .map_err(|error| format!("Could not start the YouTube client: {error}"))?
        .get(url)
        .header(reqwest::header::ACCEPT_LANGUAGE, "pt-BR,pt;q=0.9,en;q=0.8")
        // Skips the cookie-consent page some regions get first.
        .header(reqwest::header::COOKIE, "SOCS=CAI")
        .send()
        .await
        .map_err(|error| format!("Could not reach YouTube: {error}"))?
        .text()
        .await
        .map_err(|error| format!("Could not read YouTube: {error}"))?;
    Ok(videos_in_page(&html))
}

/// Pulls the result list out of the page's `ytInitialData` JSON.
fn videos_in_page(html: &str) -> Vec<Candidate> {
    let Some(start) = ["var ytInitialData = ", "window[\"ytInitialData\"] = "]
        .iter()
        .find_map(|marker| html.find(marker).map(|at| at + marker.len()))
    else {
        return Vec::new();
    };
    let Some(length) = html[start..].find(";</script>") else { return Vec::new() };
    let Ok(data) = serde_json::from_str::<Value>(&html[start..start + length]) else { return Vec::new() };
    let mut found = Vec::new();
    collect_videos(&data, &mut found);
    found
}

fn collect_videos(value: &Value, found: &mut Vec<Candidate>) {
    match value {
        Value::Object(map) => {
            if let Some(video) = map.get("videoRenderer") {
                let text = |pointer: &str| video.pointer(pointer).and_then(Value::as_str).map(str::to_string);
                if let (Some(id), Some(title)) = (text("/videoId"), text("/title/runs/0/text")) {
                    if !found.iter().any(|candidate: &Candidate| candidate.id == id) {
                        found.push(Candidate {
                            id,
                            title,
                            channel: text("/ownerText/runs/0/text").or_else(|| text("/longBylineText/runs/0/text")).unwrap_or_default(),
                            seconds: clock_seconds(&text("/lengthText/simpleText").unwrap_or_default()),
                        });
                    }
                }
            }
            for child in map.values() {
                collect_videos(child, found);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| collect_videos(item, found)),
        _ => {}
    }
}

/// "2:15" or "1:02:03" into seconds.
fn clock_seconds(clock: &str) -> u32 {
    clock
        .split(':')
        .filter_map(|part| part.trim().parse::<u32>().ok())
        .fold(0, |total, part| total * 60 + part)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn candidate(title: &str, channel: &str, seconds: u32) -> Candidate {
        Candidate { id: title.into(), title: title.into(), channel: channel.into(), seconds }
    }

    #[test]
    fn durations_parse() {
        assert_eq!(seconds_of("PT4M42S"), 282);
        assert_eq!(seconds_of("PT1H2M"), 3720);
        assert_eq!(seconds_of("PT59S"), 59);
    }

    #[test]
    fn the_official_recording_beats_covers_and_live_cuts() {
        let topic = candidate("Flash (Ao Vivo)", "Hugo & Guilherme - Topic", 131);
        let cover = candidate("Flash (Ao Vivo) - cover no violão", "Fulano Covers", 140);
        let long = candidate("Hugo e Guilherme - Flash (Ao Vivo) | DVD completo", "Hugo & Guilherme", 3600);
        let mut list = vec![cover.clone(), long.clone(), topic.clone()];
        list.sort_by_key(|item| -score(item, "Flash (Ao Vivo)", "Hugo & Guilherme", 131));
        assert_eq!(list[0], topic);
        assert_eq!(list[2], cover);
    }

    #[test]
    fn the_public_results_page_is_read() {
        let html = r#"<script>var ytInitialData = {"contents":{"items":[{"videoRenderer":{"videoId":"S3OPdoM-We4","title":{"runs":[{"text":"Hugo e Guilherme - Flash"}]},"ownerText":{"runs":[{"text":"Hugo e Guilherme"}]},"lengthText":{"simpleText":"2:15"}}},{"videoRenderer":{"videoId":"8pOcy54OGVg","title":{"runs":[{"text":"DVD Completo"}]},"lengthText":{"simpleText":"1:19:19"}}}]}};</script>"#;
        let found = videos_in_page(html);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].id, "S3OPdoM-We4");
        assert_eq!(found[0].seconds, 135);
        assert_eq!(found[1].seconds, 4759);
        assert!(videos_in_page("<html>no data</html>").is_empty());
    }

    #[test]
    fn studio_songs_skip_live_cuts_and_live_songs_keep_them() {
        let studio = candidate("Anitta - Envolver (Official Audio)", "Anitta", 193);
        let live = candidate("Anitta - Envolver (Ao Vivo)", "Anitta", 195);
        assert!(score(&studio, "Envolver", "Anitta", 193) > score(&live, "Envolver", "Anitta", 193));
        assert!(score(&live, "Envolver (Ao Vivo)", "Anitta", 195) > score(&studio, "Envolver (Ao Vivo)", "Anitta", 195));
    }

    #[test]
    fn keys_look_like_google_keys() {
        assert!(valid_key("AIzaSyA1234567890abcdefghijklmnopqrstuv"));
        assert!(!valid_key("AIza-short"));
        assert!(!valid_key("XXzaSyA1234567890abcdefghijklmnopqrstuv"));
    }
}
