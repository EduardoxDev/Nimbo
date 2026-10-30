use serde::{Deserialize, Serialize};
use std::time::Duration;

const LRCLIB_BASE_URL: &str = "https://lrclib.net/api";
const USER_AGENT: &str = concat!(
    "Nimbo/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/EduardoxDev/Nimbo)"
);

/// Lyrics as LRCLIB returns them. `synced` is LRC text (`[mm:ss.xx] line`).
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Lyrics {
    #[serde(alias = "syncedLyrics")]
    synced: Option<String>,
    #[serde(alias = "plainLyrics")]
    plain: Option<String>,
    #[serde(default)]
    instrumental: bool,
}

impl Lyrics {
    fn has_content(&self) -> bool {
        self.instrumental || self.synced.is_some() || self.plain.is_some()
    }
}

/// Looks the track up on LRCLIB (free, no key). Only the title, artist, album
/// and duration leave the machine. `None` means no lyrics were found.
#[tauri::command]
pub(crate) async fn fetch_lyrics(
    title: String,
    artist: String,
    album: Option<String>,
    duration_ms: Option<i64>,
) -> Result<Option<Lyrics>, String> {
    let title = title.trim();
    let artist = artist.trim();
    if title.is_empty() || artist.is_empty() {
        return Ok(None);
    }

    let client = reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(8))
        .build()
        .map_err(|error| format!("Failed to create the lyrics client: {error}"))?;

    let mut params = vec![("track_name", title.to_string()), ("artist_name", artist.to_string())];
    if let Some(album) = album.as_deref().map(str::trim).filter(|album| !album.is_empty()) {
        params.push(("album_name", album.to_string()));
    }
    if let Some(duration_ms) = duration_ms.filter(|value| *value > 0) {
        params.push(("duration", ((duration_ms + 500) / 1000).to_string()));
    }

    // The exact lookup needs a matching duration; fall back to search when it misses.
    let exact_url = reqwest::Url::parse_with_params(&format!("{LRCLIB_BASE_URL}/get"), &params)
        .map_err(|error| format!("Failed to build the lyrics URL: {error}"))?;
    let response = client
        .get(exact_url)
        .send()
        .await
        .map_err(|error| format!("Failed to reach LRCLIB: {error}"))?;
    if response.status().is_success() {
        let lyrics: Lyrics = response
            .json()
            .await
            .map_err(|error| format!("Failed to read the LRCLIB answer: {error}"))?;
        if lyrics.has_content() {
            return Ok(Some(lyrics));
        }
    }

    let search_url = reqwest::Url::parse_with_params(
        &format!("{LRCLIB_BASE_URL}/search"),
        &[("track_name", title), ("artist_name", artist)],
    )
    .map_err(|error| format!("Failed to build the lyrics search URL: {error}"))?;
    let results: Vec<Lyrics> = client
        .get(search_url)
        .send()
        .await
        .map_err(|error| format!("Failed to reach LRCLIB: {error}"))?
        .error_for_status()
        .map_err(|error| format!("LRCLIB refused the search: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Failed to read the LRCLIB search: {error}"))?;

    let mut results = results.into_iter().filter(Lyrics::has_content);
    let first = results.next();
    if first.as_ref().is_some_and(|lyrics| lyrics.synced.is_some()) {
        return Ok(first);
    }
    Ok(results.find(|lyrics| lyrics.synced.is_some()).or(first))
}
