//! Nimbo Music: browses the public Deezer catalog (free, no key, no login).
//! Covers come in up to 1000 px and every track has a 30 s preview. The API
//! sends no CORS headers, so the window asks through these commands.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

const DEEZER_API: &str = "https://api.deezer.com";
const USER_AGENT: &str = concat!(
    "Nimbo/",
    env!("CARGO_PKG_VERSION"),
    " (https://github.com/EduardoxDev/Nimbo)"
);
pub(crate) const MUSIC_WINDOW_LABEL: &str = "music";

// ---------- What the window receives ----------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Track {
    id: u64,
    title: String,
    duration: u32,
    preview: Option<String>,
    explicit: bool,
    artist_id: u64,
    artist_name: String,
    album_id: u64,
    album_title: String,
    cover: Option<String>,
    cover_xl: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Album {
    id: u64,
    title: String,
    cover: Option<String>,
    cover_xl: Option<String>,
    artist_id: Option<u64>,
    artist_name: Option<String>,
    release_date: Option<String>,
    record_type: Option<String>,
    track_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Artist {
    id: u64,
    name: String,
    picture: Option<String>,
    picture_xl: Option<String>,
    fans: Option<u64>,
    album_count: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Genre {
    id: u64,
    name: String,
    picture: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Shelf {
    tracks: Vec<Track>,
    albums: Vec<Album>,
    artists: Vec<Artist>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArtistPage {
    artist: Artist,
    top: Vec<Track>,
    albums: Vec<Album>,
    related: Vec<Artist>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AlbumPage {
    album: Album,
    tracks: Vec<Track>,
}

// ---------- What Deezer sends ----------

#[derive(Debug, Deserialize)]
struct List<T> {
    #[serde(default = "Vec::new")]
    data: Vec<T>,
}

#[derive(Debug, Deserialize)]
struct DeezerError {
    message: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct RawArtist {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    name: String,
    picture_medium: Option<String>,
    picture_xl: Option<String>,
    nb_fan: Option<u64>,
    nb_album: Option<u32>,
}

#[derive(Debug, Default, Deserialize)]
struct RawAlbum {
    #[serde(default)]
    id: u64,
    #[serde(default)]
    title: String,
    cover_medium: Option<String>,
    cover_xl: Option<String>,
    artist: Option<RawArtist>,
    release_date: Option<String>,
    record_type: Option<String>,
    nb_tracks: Option<u32>,
    tracks: Option<List<RawTrack>>,
}

#[derive(Debug, Deserialize)]
struct RawTrack {
    id: u64,
    #[serde(default)]
    title: String,
    #[serde(default)]
    duration: u32,
    preview: Option<String>,
    #[serde(default)]
    explicit_lyrics: bool,
    #[serde(default = "readable_default")]
    readable: bool,
    #[serde(default)]
    artist: RawArtist,
    album: Option<RawAlbum>,
}

fn readable_default() -> bool {
    true
}

#[derive(Debug, Deserialize)]
struct RawGenre {
    id: u64,
    #[serde(default)]
    name: String,
    picture_medium: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RawChart {
    tracks: Option<List<RawTrack>>,
    albums: Option<List<RawAlbum>>,
    artists: Option<List<RawArtist>>,
}

fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty())
}

impl From<RawArtist> for Artist {
    fn from(raw: RawArtist) -> Self {
        Self {
            id: raw.id,
            name: raw.name,
            picture: non_empty(raw.picture_medium),
            picture_xl: non_empty(raw.picture_xl),
            fans: raw.nb_fan,
            album_count: raw.nb_album,
        }
    }
}

impl From<RawAlbum> for Album {
    fn from(raw: RawAlbum) -> Self {
        let artist = raw.artist;
        Self {
            id: raw.id,
            title: raw.title,
            cover: non_empty(raw.cover_medium),
            cover_xl: non_empty(raw.cover_xl),
            artist_id: artist.as_ref().map(|artist| artist.id),
            artist_name: artist.map(|artist| artist.name),
            release_date: non_empty(raw.release_date),
            record_type: non_empty(raw.record_type),
            track_count: raw.nb_tracks,
        }
    }
}

/// `album` fills in what album track lists leave out (they carry no album).
fn to_track(raw: RawTrack, album: Option<&Album>) -> Track {
    let own = raw.album;
    Track {
        id: raw.id,
        title: raw.title,
        duration: raw.duration,
        preview: non_empty(raw.preview),
        explicit: raw.explicit_lyrics,
        artist_id: raw.artist.id,
        artist_name: raw.artist.name,
        album_id: own.as_ref().map(|album| album.id).or(album.map(|album| album.id)).unwrap_or(0),
        album_title: own
            .as_ref()
            .map(|album| album.title.clone())
            .or_else(|| album.map(|album| album.title.clone()))
            .unwrap_or_default(),
        cover: own
            .as_ref()
            .and_then(|album| non_empty(album.cover_medium.clone()))
            .or_else(|| album.and_then(|album| album.cover.clone())),
        cover_xl: own
            .and_then(|album| non_empty(album.cover_xl))
            .or_else(|| album.and_then(|album| album.cover_xl.clone())),
    }
}

fn tracks(list: Option<List<RawTrack>>, album: Option<&Album>) -> Vec<Track> {
    list.map(|list| list.data)
        .unwrap_or_default()
        .into_iter()
        .filter(|track| track.readable)
        .map(|track| to_track(track, album))
        .collect()
}

// ---------- Requests ----------

fn client(locale: Option<&str>) -> Result<reqwest::Client, String> {
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(value) = locale
        .filter(|tag| tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        .and_then(|tag| reqwest::header::HeaderValue::from_str(tag).ok())
    {
        headers.insert(reqwest::header::ACCEPT_LANGUAGE, value);
    }
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .default_headers(headers)
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|error| format!("Could not start the music client: {error}"))
}

async fn get<T: DeserializeOwned>(
    client: &reqwest::Client,
    path: &str,
    params: &[(&str, String)],
) -> Result<T, String> {
    let url = reqwest::Url::parse_with_params(&format!("{DEEZER_API}{path}"), params)
        .map_err(|error| format!("Could not build the catalog address: {error}"))?;
    let body: serde_json::Value = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("Could not reach the music catalog: {error}"))?
        .error_for_status()
        .map_err(|error| format!("The music catalog refused the request: {error}"))?
        .json()
        .await
        .map_err(|error| format!("Could not read the music catalog: {error}"))?;
    // Deezer answers errors with 200 and an `error` object.
    if let Some(error) = body.get("error") {
        let message = serde_json::from_value::<DeezerError>(error.clone())
            .ok()
            .and_then(|error| error.message)
            .unwrap_or_else(|| "unknown error".into());
        return Err(format!("The music catalog answered: {message}"));
    }
    serde_json::from_value(body).map_err(|error| format!("Unexpected catalog answer: {error}"))
}

/// Runs a request on its own task so several can be in flight at once.
fn spawn_get<T: DeserializeOwned + Send + 'static>(
    client: &reqwest::Client,
    path: String,
    params: Vec<(&'static str, String)>,
) -> tauri::async_runtime::JoinHandle<Result<T, String>> {
    let client = client.clone();
    tauri::async_runtime::spawn(async move { get(&client, &path, &params).await })
}

async fn join<T>(handle: tauri::async_runtime::JoinHandle<Result<T, String>>) -> Result<T, String> {
    handle.await.map_err(|error| format!("The catalog request stopped: {error}"))?
}

// ---------- Commands ----------

/// What is hot right now. `genre_id` 0 (or none) means every genre.
#[tauri::command]
pub(crate) async fn music_chart(genre_id: Option<u64>, locale: Option<String>) -> Result<Shelf, String> {
    let client = client(locale.as_deref())?;
    let chart: RawChart = get(
        &client,
        &format!("/chart/{}", genre_id.unwrap_or(0)),
        &[("limit", "40".into())],
    )
    .await?;
    Ok(Shelf {
        tracks: tracks(chart.tracks, None),
        albums: chart.albums.map(|list| list.data).unwrap_or_default().into_iter().map(Album::from).collect(),
        artists: chart.artists.map(|list| list.data).unwrap_or_default().into_iter().map(Artist::from).collect(),
    })
}

#[tauri::command]
pub(crate) async fn music_genres(locale: Option<String>) -> Result<Vec<Genre>, String> {
    let client = client(locale.as_deref())?;
    let list: List<RawGenre> = get(&client, "/genre", &[]).await?;
    Ok(list
        .data
        .into_iter()
        .filter(|genre| genre.id != 0)
        .map(|genre| Genre { id: genre.id, name: genre.name, picture: non_empty(genre.picture_medium) })
        .collect())
}

/// Songs, artists and albums matching `query`, searched in parallel.
#[tauri::command]
pub(crate) async fn music_search(query: String, locale: Option<String>) -> Result<Shelf, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Ok(Shelf { tracks: Vec::new(), albums: Vec::new(), artists: Vec::new() });
    }
    let client = client(locale.as_deref())?;
    let songs = spawn_get::<List<RawTrack>>(&client, "/search".into(), vec![("q", query.clone()), ("limit", "40".into())]);
    let artists = spawn_get::<List<RawArtist>>(&client, "/search/artist".into(), vec![("q", query.clone()), ("limit", "16".into())]);
    let albums = spawn_get::<List<RawAlbum>>(&client, "/search/album".into(), vec![("q", query.clone()), ("limit", "24".into())]);
    let mut artists: Vec<Artist> = join(artists).await?.data.into_iter().map(Artist::from).collect();
    rank_artists(&mut artists, &query);
    Ok(Shelf {
        tracks: tracks(Some(join(songs).await?), None),
        artists,
        albums: join(albums).await?.data.into_iter().map(Album::from).collect(),
    })
}

/// Deezer often ranks a tiny namesake above the real artist, so exact names
/// come first and, among them, the one with more fans.
fn rank_artists(artists: &mut [Artist], query: &str) {
    let query = query.to_lowercase();
    let closeness = |artist: &Artist| {
        let name = artist.name.to_lowercase();
        if name == query {
            2
        } else if name.starts_with(&query) {
            1
        } else {
            0
        }
    };
    artists.sort_by(|a, b| {
        closeness(b)
            .cmp(&closeness(a))
            .then(b.fans.unwrap_or(0).cmp(&a.fans.unwrap_or(0)))
    });
}

#[tauri::command]
pub(crate) async fn music_artist(id: u64, locale: Option<String>) -> Result<ArtistPage, String> {
    let client = client(locale.as_deref())?;
    let artist = spawn_get::<RawArtist>(&client, format!("/artist/{id}"), Vec::new());
    let top = spawn_get::<List<RawTrack>>(&client, format!("/artist/{id}/top"), vec![("limit", "20".into())]);
    let albums = spawn_get::<List<RawAlbum>>(&client, format!("/artist/{id}/albums"), vec![("limit", "60".into())]);
    let related = spawn_get::<List<RawArtist>>(&client, format!("/artist/{id}/related"), vec![("limit", "12".into())]);
    let artist = Artist::from(join(artist).await?);
    let mut albums: Vec<Album> = join(albums).await?.data.into_iter().map(Album::from).collect();
    // Newest first; the API mixes the order.
    albums.sort_by(|a, b| b.release_date.cmp(&a.release_date));
    Ok(ArtistPage {
        top: tracks(Some(join(top).await?), None),
        albums,
        related: join(related).await.map(|list| list.data).unwrap_or_default().into_iter().map(Artist::from).collect(),
        artist,
    })
}

#[tauri::command]
pub(crate) async fn music_album(id: u64, locale: Option<String>) -> Result<AlbumPage, String> {
    let client = client(locale.as_deref())?;
    let mut raw: RawAlbum = get(&client, &format!("/album/{id}"), &[]).await?;
    let list = raw.tracks.take();
    let album = Album::from(raw);
    Ok(AlbumPage { tracks: tracks(list, Some(&album)), album })
}

/// A fresh copy of one track: preview links expire, so saved songs ask again.
#[tauri::command]
pub(crate) async fn music_track(id: u64) -> Result<Track, String> {
    let client = client(None)?;
    let raw: RawTrack = get(&client, &format!("/track/{id}"), &[]).await?;
    Ok(to_track(raw, None))
}

/// Opens the full song in a streaming service. Only the title and artist leave
/// the machine, and the address is built here so the page cannot pick one.
#[tauri::command]
pub(crate) fn music_open_external(app: AppHandle, service: String, title: String, artist: String) -> Result<(), String> {
    let query = format!("{} {}", title.trim(), artist.trim());
    let query = query.trim();
    if query.is_empty() {
        return Err("Nothing to look up".into());
    }
    let encoded: String = reqwest::Url::parse_with_params("https://x.invalid/", &[("q", query)])
        .map_err(|error| format!("Could not encode the song: {error}"))?
        .query()
        .unwrap_or_default()
        .trim_start_matches("q=")
        .replace('+', "%20");
    let url = match service.as_str() {
        "spotify" => format!("spotify:search:{encoded}"),
        "spotifyWeb" => format!("https://open.spotify.com/search/{encoded}"),
        "youtube" => format!("https://music.youtube.com/search?q={encoded}"),
        "deezer" => format!("https://www.deezer.com/search/{encoded}"),
        _ => return Err(format!("Unknown service: {service}")),
    };
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| format!("Could not open {service}: {error}"))
}

#[tauri::command]
pub(crate) async fn open_music_window(app: AppHandle) -> Result<(), String> {
    show_music_window(&app)
}

pub(crate) fn show_music_window(app: &AppHandle) -> Result<(), String> {
    let window = match app.get_webview_window(MUSIC_WINDOW_LABEL) {
        Some(window) => window,
        None => WebviewWindowBuilder::new(app, MUSIC_WINDOW_LABEL, WebviewUrl::App("index.html?window=music".into()))
            .title("Nimbo Music")
            .inner_size(1120.0, 720.0)
            .min_inner_size(820.0, 560.0)
            .center()
            .decorations(false)
            .transparent(true)
            .resizable(true)
            .shadow(true)
            .visible(false)
            .build()
            .map_err(|error| error.to_string())?,
    };
    if window.is_minimized().unwrap_or(false) {
        window.unminimize().map_err(|error| error.to_string())?;
    }
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artist(name: &str, fans: u64) -> Artist {
        Artist { id: fans, name: name.into(), picture: None, picture_xl: None, fans: Some(fans), album_count: None }
    }

    #[test]
    fn the_famous_namesake_wins() {
        let mut list = vec![artist("Anitta", 35), artist("Anitta", 7_417_478), artist("Anita Ward", 10_981)];
        rank_artists(&mut list, "anitta");
        assert_eq!(list[0].fans, Some(7_417_478));
        assert_eq!(list[2].name, "Anita Ward");
    }

    #[test]
    fn album_tracks_borrow_the_album_cover() {
        let raw: RawTrack = serde_json::from_str(
            r#"{"id":1,"title":"One More Time","duration":320,"preview":"","artist":{"id":27,"name":"Daft Punk"}}"#,
        )
        .unwrap();
        let album = Album {
            id: 302127,
            title: "Discovery".into(),
            cover: Some("c.jpg".into()),
            cover_xl: Some("cxl.jpg".into()),
            artist_id: Some(27),
            artist_name: Some("Daft Punk".into()),
            release_date: None,
            record_type: None,
            track_count: None,
        };
        let track = to_track(raw, Some(&album));
        assert_eq!(track.album_id, 302127);
        assert_eq!(track.cover.as_deref(), Some("c.jpg"));
        assert_eq!(track.preview, None);
    }
}
