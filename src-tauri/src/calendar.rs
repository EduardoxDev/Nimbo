use chrono::{DateTime, Duration as ChronoDuration, NaiveDate, NaiveDateTime, TimeZone, Utc};
use keyring::{Entry, Error as KeyringError};
use rrule::{RRule, Tz, Unvalidated};
use serde::{Deserialize, Serialize};
use std::{collections::HashSet, str::FromStr, time::Duration};

const CREDENTIAL_SERVICE: &str = "com.nimbo.app.calendar";
const CREDENTIAL_USER: &str = "sources";
const MAX_SOURCES: usize = 8;
const MAX_URL_LENGTH: usize = 1_500;
const MAX_CALENDAR_BYTES: usize = 8 * 1024 * 1024;
const MAX_DAYS: u32 = 31;
const MAX_OCCURRENCES_PER_EVENT: u16 = 200;
const WINDOWS_TIME_ZONES: [(&str, &str); 8] = [
    ("E. South America Standard Time", "America/Sao_Paulo"),
    ("SA Pacific Standard Time", "America/Bogota"),
    ("Eastern Standard Time", "America/New_York"),
    ("Central Standard Time", "America/Chicago"),
    ("Pacific Standard Time", "America/Los_Angeles"),
    ("GMT Standard Time", "Europe/London"),
    ("W. Europe Standard Time", "Europe/Berlin"),
    ("China Standard Time", "Asia/Shanghai"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct StoredSource {
    name: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalendarSource {
    name: String,
    host: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalendarEvent {
    id: String,
    title: String,
    location: Option<String>,
    /// The video call link (Meet, Teams, Zoom…) found in the event, if any.
    link: Option<String>,
    start: i64,
    end: i64,
    all_day: bool,
    calendar: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CalendarResult {
    events: Vec<CalendarEvent>,
    failed: Vec<String>,
}

#[derive(Default)]
struct RawEvent {
    uid: String,
    summary: String,
    location: Option<String>,
    /// From the conference fields first, then the location, then the description.
    link: Option<String>,
    description_link: Option<String>,
    start: Option<(String, Option<String>)>,
    end: Option<(String, Option<String>)>,
    duration: Option<String>,
    rrule: Option<String>,
    exdates: Vec<(String, Option<String>)>,
    recurrence_id: Option<(String, Option<String>)>,
    cancelled: bool,
}

fn credential() -> Result<Entry, String> {
    Entry::new(CREDENTIAL_SERVICE, CREDENTIAL_USER).map_err(|error| error.to_string())
}

fn load_sources() -> Result<Vec<StoredSource>, String> {
    match credential()?.get_password() {
        Ok(raw) => Ok(serde_json::from_str(&raw).unwrap_or_default()),
        Err(KeyringError::NoEntry) => Ok(Vec::new()),
        Err(error) => Err(format!("Could not read Windows Credential Manager: {error}")),
    }
}

fn save_sources(sources: &[StoredSource]) -> Result<(), String> {
    if sources.is_empty() {
        return match credential()?.delete_credential() {
            Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
            Err(error) => Err(format!("Could not update Windows Credential Manager: {error}")),
        };
    }
    let raw = serde_json::to_string(sources).map_err(|error| error.to_string())?;
    credential()?
        .set_password(&raw)
        .map_err(|error| format!("Could not save to Windows Credential Manager: {error}"))
}

fn host_of(url: &str) -> String {
    url.split("://")
        .nth(1)
        .and_then(|rest| rest.split(['/', '?', '#']).next())
        .unwrap_or_default()
        .to_string()
}

fn describe(sources: &[StoredSource]) -> Vec<CalendarSource> {
    sources
        .iter()
        .map(|source| CalendarSource { name: source.name.clone(), host: host_of(&source.url) })
        .collect()
}

fn normalize_url(url: &str) -> Result<String, String> {
    let url = url.trim();
    let url = match url.strip_prefix("webcal://") {
        Some(rest) => format!("https://{rest}"),
        None => url.to_string(),
    };
    if !url.starts_with("https://") || host_of(&url).is_empty() {
        return Err("Use the calendar's secret address (https:// or webcal://).".to_string());
    }
    if url.len() > MAX_URL_LENGTH || url.chars().any(char::is_whitespace) {
        return Err("That address does not look right.".to_string());
    }
    Ok(url)
}

#[tauri::command]
pub(crate) fn calendar_sources() -> Result<Vec<CalendarSource>, String> {
    Ok(describe(&load_sources()?))
}

#[tauri::command]
pub(crate) fn calendar_add_source(name: String, url: String) -> Result<Vec<CalendarSource>, String> {
    let url = normalize_url(&url)?;
    let mut sources = load_sources()?;
    if sources.len() >= MAX_SOURCES {
        return Err(format!("Up to {MAX_SOURCES} calendars."));
    }
    if sources.iter().any(|source| source.url == url) {
        return Err("This calendar is already added.".to_string());
    }
    let name = name.trim();
    let name = if name.is_empty() { host_of(&url) } else { name.chars().take(40).collect() };
    sources.push(StoredSource { name, url });
    save_sources(&sources)?;
    Ok(describe(&sources))
}

#[tauri::command]
pub(crate) fn calendar_remove_source(index: usize) -> Result<Vec<CalendarSource>, String> {
    let mut sources = load_sources()?;
    if index < sources.len() {
        sources.remove(index);
        save_sources(&sources)?;
    }
    Ok(describe(&sources))
}

#[tauri::command]
pub(crate) async fn calendar_events(days: u32) -> Result<CalendarResult, String> {
    let sources = load_sources()?;
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| error.to_string())?;
    let now = Utc::now();
    let window_start = now - ChronoDuration::hours(12);
    let window_end = now + ChronoDuration::days(days.clamp(1, MAX_DAYS) as i64);
    let mut events = Vec::new();
    let mut failed = Vec::new();

    for source in sources {
        match fetch(&client, &source.url).await {
            Ok(ics) => events.extend(
                parse_calendar(&ics, window_start, window_end)
                    .into_iter()
                    .map(|event| CalendarEvent { calendar: source.name.clone(), ..event }),
            ),
            Err(error) => {
                crate::diagnostics::log("calendar", &format!("{} failed: {error}", source.name));
                failed.push(source.name);
            }
        }
    }
    events.sort_by_key(|event| (event.start, event.end));
    Ok(CalendarResult { events, failed })
}

async fn fetch(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let response = client.get(url).send().await.map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }
    if response.content_length().unwrap_or(0) as usize > MAX_CALENDAR_BYTES {
        return Err("calendar too large".to_string());
    }
    let bytes = response.bytes().await.map_err(|error| error.to_string())?;
    if bytes.len() > MAX_CALENDAR_BYTES {
        return Err("calendar too large".to_string());
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

fn unfold(ics: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for line in ics.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        match line.strip_prefix([' ', '\t']) {
            Some(rest) if !lines.is_empty() => lines.last_mut().unwrap().push_str(rest),
            _ => lines.push(line.to_string()),
        }
    }
    lines
}

fn unescape(value: &str) -> String {
    let mut output = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(ch) = chars.next() {
        if ch != '\\' {
            output.push(ch);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => output.push('\n'),
            Some(other) => output.push(other),
            None => {}
        }
    }
    output.trim().to_string()
}

/// Hosts of video calls the island can join.
const MEETING_HOSTS: [&str; 8] = ["meet.google.com", "teams.microsoft.com", "teams.live.com", "zoom.us", "whereby.com", "webex.com", "meet.jit.si", "around.co"];

/// The first video call link in a text: https only, on a known host (or a subdomain of one).
fn meeting_link(text: &str) -> Option<String> {
    text.match_indices("https://").find_map(|(start, _)| {
        let rest = &text[start..];
        let end = rest.find(|char: char| char.is_whitespace() || matches!(char, '"' | '<' | '>' | '\\')).unwrap_or(rest.len());
        let url = rest[..end].trim_end_matches(['.', ',', ';', ')', ']']);
        let host = url["https://".len()..].split(['/', '?', '#']).next()?.to_ascii_lowercase();
        let known = MEETING_HOSTS.iter().any(|known| host == *known || host.ends_with(&format!(".{known}")));
        (known && url.len() <= MAX_URL_LENGTH).then(|| url.to_string())
    })
}

fn split_property(line: &str) -> Option<(String, Option<String>, bool, String)> {
    let (head, value) = line.split_once(':')?;
    let mut parts = head.split(';');
    let name = parts.next()?.to_ascii_uppercase();
    let mut tzid = None;
    let mut is_date = false;
    for param in parts {
        if let Some((key, param_value)) = param.split_once('=') {
            match key.to_ascii_uppercase().as_str() {
                "TZID" => tzid = Some(param_value.trim_matches('"').to_string()),
                "VALUE" => is_date = param_value.eq_ignore_ascii_case("DATE"),
                _ => {}
            }
        }
    }
    let marker = if is_date { Some("DATE".to_string()) } else { tzid };
    Some((name, marker, is_date, value.to_string()))
}

fn read_events(ics: &str) -> Vec<RawEvent> {
    let mut events = Vec::new();
    let mut current: Option<RawEvent> = None;
    for line in unfold(ics) {
        if line.eq_ignore_ascii_case("BEGIN:VEVENT") {
            current = Some(RawEvent::default());
            continue;
        }
        if line.eq_ignore_ascii_case("END:VEVENT") {
            if let Some(event) = current.take() {
                events.push(event);
            }
            continue;
        }
        let Some(event) = current.as_mut() else { continue };
        let Some((name, marker, _, value)) = split_property(&line) else { continue };
        match name.as_str() {
            "UID" => event.uid = value,
            "SUMMARY" => event.summary = unescape(&value),
            "LOCATION" => {
                event.location = Some(unescape(&value)).filter(|location| !location.is_empty());
                if event.link.is_none() {
                    event.link = meeting_link(&unescape(&value));
                }
            }
            "X-GOOGLE-CONFERENCE" | "X-MICROSOFT-SKYPETEAMSMEETINGURL" | "URL" => {
                if let Some(link) = meeting_link(&value) {
                    event.link = Some(link);
                }
            }
            "DESCRIPTION" => event.description_link = meeting_link(&unescape(&value)),
            "DTSTART" => event.start = Some((value, marker)),
            "DTEND" => event.end = Some((value, marker)),
            "DURATION" => event.duration = Some(value),
            "RRULE" => event.rrule = Some(value),
            "EXDATE" => event
                .exdates
                .extend(value.split(',').map(|date| (date.to_string(), marker.clone()))),
            "RECURRENCE-ID" => event.recurrence_id = Some((value, marker)),
            "STATUS" => event.cancelled = value.eq_ignore_ascii_case("CANCELLED"),
            _ => {}
        }
    }
    events
}

fn zone_for(tzid: &str) -> Option<Tz> {
    let name = WINDOWS_TIME_ZONES
        .iter()
        .find(|(windows, _)| windows.eq_ignore_ascii_case(tzid))
        .map(|(_, iana)| *iana)
        .unwrap_or(tzid);
    chrono_tz::Tz::from_str(name).ok().map(Tz::Tz)
}

fn parse_time(value: &str, marker: Option<&str>) -> Option<(DateTime<Tz>, bool)> {
    let value = value.trim();
    if marker == Some("DATE") || (value.len() == 8 && value.chars().all(|ch| ch.is_ascii_digit())) {
        let date = NaiveDate::parse_from_str(&value[..8.min(value.len())], "%Y%m%d").ok()?;
        let local = Tz::LOCAL.from_local_datetime(&date.and_hms_opt(0, 0, 0)?).earliest()?;
        return Some((local, true));
    }
    if let Some(utc) = value.strip_suffix('Z') {
        let naive = NaiveDateTime::parse_from_str(utc, "%Y%m%dT%H%M%S").ok()?;
        return Some((Tz::UTC.from_utc_datetime(&naive), false));
    }
    let naive = NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S").ok()?;
    let zone = marker.and_then(zone_for).unwrap_or(Tz::LOCAL);
    Some((zone.from_local_datetime(&naive).earliest()?, false))
}

fn parse_duration(value: &str) -> Option<ChronoDuration> {
    let value = value.trim();
    let (negative, value) = match value.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, value.strip_prefix('+').unwrap_or(value)),
    };
    let value = value.strip_prefix('P')?;
    let mut total = ChronoDuration::zero();
    let mut number = String::new();
    for ch in value.chars() {
        match ch {
            '0'..='9' => number.push(ch),
            'T' => {}
            unit => {
                let amount: i64 = number.parse().ok()?;
                number.clear();
                total += match unit {
                    'W' => ChronoDuration::weeks(amount),
                    'D' => ChronoDuration::days(amount),
                    'H' => ChronoDuration::hours(amount),
                    'M' => ChronoDuration::minutes(amount),
                    'S' => ChronoDuration::seconds(amount),
                    _ => return None,
                };
            }
        }
    }
    Some(if negative { -total } else { total })
}

fn occurrences(start: DateTime<Tz>, rule: Option<&str>, window_start: DateTime<Tz>, window_end: DateTime<Tz>) -> Vec<DateTime<Tz>> {
    let Some(rule) = rule else {
        return vec![start];
    };
    let set = rule
        .parse::<RRule<Unvalidated>>()
        .and_then(|rule| rule.build(start))
        .map(|set| set.after(window_start).before(window_end).all(MAX_OCCURRENCES_PER_EVENT).dates);
    set.unwrap_or_else(|_| vec![start])
}

fn parse_calendar(ics: &str, window_start: DateTime<Utc>, window_end: DateTime<Utc>) -> Vec<CalendarEvent> {
    let raw_events = read_events(ics);
    let overridden: HashSet<(String, i64)> = raw_events
        .iter()
        .filter_map(|event| {
            let (value, marker) = event.recurrence_id.as_ref()?;
            let (time, _) = parse_time(value, marker.as_deref())?;
            Some((event.uid.clone(), time.timestamp()))
        })
        .collect();
    let expand_from = window_start.with_timezone(&Tz::UTC) - ChronoDuration::days(2);
    let expand_to = window_end.with_timezone(&Tz::UTC);
    let mut events = Vec::new();

    for event in raw_events.iter().filter(|event| !event.cancelled) {
        let Some((value, marker)) = event.start.as_ref() else { continue };
        let Some((start, all_day)) = parse_time(value, marker.as_deref()) else { continue };
        let length = event
            .end
            .as_ref()
            .and_then(|(value, marker)| parse_time(value, marker.as_deref()))
            .map(|(end, _)| end - start)
            .or_else(|| event.duration.as_deref().and_then(parse_duration))
            .unwrap_or_else(|| if all_day { ChronoDuration::days(1) } else { ChronoDuration::zero() })
            .max(ChronoDuration::zero());
        let excluded: HashSet<i64> = event
            .exdates
            .iter()
            .filter_map(|(value, marker)| parse_time(value, marker.as_deref()))
            .map(|(time, _)| time.timestamp())
            .collect();
        let recurring = event.recurrence_id.is_none() && event.rrule.is_some();

        for occurrence in occurrences(start, event.rrule.as_deref().filter(|_| recurring), expand_from, expand_to) {
            let begin = occurrence.timestamp();
            if excluded.contains(&begin) || (recurring && overridden.contains(&(event.uid.clone(), begin))) {
                continue;
            }
            let finish = occurrence + length;
            if finish.with_timezone(&Utc) <= window_start || occurrence.with_timezone(&Utc) >= window_end {
                continue;
            }
            events.push(CalendarEvent {
                id: format!("{}-{begin}", event.uid),
                title: if event.summary.is_empty() { "(sem título)".to_string() } else { event.summary.clone() },
                location: event.location.clone(),
                link: event.link.clone().or_else(|| event.description_link.clone()),
                start: begin * 1000,
                end: finish.timestamp() * 1000,
                all_day,
                calendar: String::new(),
            });
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(text: &str) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339(text).unwrap().with_timezone(&Utc)
    }

    const SAMPLE: &str = "BEGIN:VCALENDAR\r\n\
BEGIN:VEVENT\r\n\
UID:standup\r\n\
SUMMARY:Daily\\, time\r\n\
DTSTART;TZID=America/Sao_Paulo:20261026T093000\r\n\
DTEND;TZID=America/Sao_Paulo:20261026T094500\r\n\
RRULE:FREQ=DAILY;COUNT=10\r\n\
EXDATE;TZID=America/Sao_Paulo:20261028T093000\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:standup\r\n\
RECURRENCE-ID;TZID=America/Sao_Paulo:20261029T093000\r\n\
SUMMARY:Daily moved\r\n\
DTSTART;TZID=America/Sao_Paulo:20261029T150000\r\n\
DTEND;TZID=America/Sao_Paulo:20261029T151500\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:dentist\r\n\
SUMMARY:Dentista\r\n\
LOCATION:Rua A\\, 10\r\n\
DTSTART:20261030T130000Z\r\n\
DURATION:PT1H\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:gone\r\n\
SUMMARY:Cancelado\r\n\
STATUS:CANCELLED\r\n\
DTSTART:20261030T150000Z\r\n\
END:VEVENT\r\n\
BEGIN:VEVENT\r\n\
UID:holiday\r\n\
SUMMARY:Feriado\r\n\
DTSTART;VALUE=DATE:20261102\r\n\
DTEND;VALUE=DATE:20261103\r\n\
END:VEVENT\r\n\
END:VCALENDAR\r\n";

    #[test]
    fn recurring_events_respect_exceptions_and_moved_instances() {
        let events = parse_calendar(SAMPLE, at("2026-10-27T00:00:00Z"), at("2026-10-31T00:00:00Z"));
        let dailies: Vec<_> = events.iter().filter(|event| event.title.starts_with("Daily")).collect();
        let starts: Vec<i64> = dailies.iter().map(|event| event.start / 1000).collect();
        assert!(starts.contains(&at("2026-10-27T12:30:00Z").timestamp()));
        assert!(!starts.contains(&at("2026-10-28T12:30:00Z").timestamp()));
        assert!(!starts.contains(&at("2026-10-29T12:30:00Z").timestamp()));
        assert!(starts.contains(&at("2026-10-29T18:00:00Z").timestamp()));
        assert!(starts.contains(&at("2026-10-30T12:30:00Z").timestamp()));
        assert_eq!(dailies[0].title, "Daily, time");
        assert_eq!(dailies[0].end - dailies[0].start, 15 * 60 * 1000);
    }

    #[test]
    fn single_events_use_duration_and_skip_cancelled_ones() {
        let events = parse_calendar(SAMPLE, at("2026-10-30T00:00:00Z"), at("2026-10-31T00:00:00Z"));
        let dentist = events.iter().find(|event| event.title == "Dentista").unwrap();
        assert_eq!(dentist.location.as_deref(), Some("Rua A, 10"));
        assert_eq!(dentist.end - dentist.start, 3_600_000);
        assert!(events.iter().all(|event| event.title != "Cancelado"));
    }

    #[test]
    fn video_call_links_are_found() {
        assert_eq!(meeting_link("Entrar: https://meet.google.com/abc-defg-hij.").as_deref(), Some("https://meet.google.com/abc-defg-hij"));
        assert_eq!(
            meeting_link("Join <https://teams.microsoft.com/l/meetup-join/19%3a123> now").as_deref(),
            Some("https://teams.microsoft.com/l/meetup-join/19%3a123")
        );
        assert_eq!(meeting_link("https://empresa.zoom.us/j/123?pwd=x").as_deref(), Some("https://empresa.zoom.us/j/123?pwd=x"));
        assert_eq!(meeting_link("Site: https://example.com/meet.google.com"), None);
        assert_eq!(meeting_link("http://meet.google.com/abc"), None);
        assert_eq!(meeting_link("https://notzoom.us/j/1"), None);

        let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:call\r\nSUMMARY:Daily\r\nDTSTART:20261105T120000Z\r\nDTEND:20261105T121500Z\r\nDESCRIPTION:Pauta\\nhttps://meet.google.com/xyz-abcd-efg\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
        let events = parse_calendar(ics, at("2026-11-05T00:00:00Z"), at("2026-11-06T00:00:00Z"));
        assert_eq!(events[0].link.as_deref(), Some("https://meet.google.com/xyz-abcd-efg"));
    }

    #[test]
    fn all_day_events_are_marked() {
        let events = parse_calendar(SAMPLE, at("2026-11-01T00:00:00Z"), at("2026-11-04T00:00:00Z"));
        let holiday = events.iter().find(|event| event.title == "Feriado").unwrap();
        assert!(holiday.all_day);
        assert_eq!(holiday.end - holiday.start, 86_400_000);
    }

    #[test]
    fn only_secret_https_addresses_are_accepted() {
        assert_eq!(normalize_url("webcal://calendar.google.com/x.ics").unwrap(), "https://calendar.google.com/x.ics");
        assert!(normalize_url("http://example.com/x.ics").is_err());
        assert!(normalize_url("file:///C:/x.ics").is_err());
        assert_eq!(host_of("https://outlook.live.com/owa/calendar/abc/reachcalendar.ics"), "outlook.live.com");
    }

    #[test]
    fn durations_parse_weeks_days_and_times() {
        assert_eq!(parse_duration("PT1H30M"), Some(ChronoDuration::minutes(90)));
        assert_eq!(parse_duration("P1D"), Some(ChronoDuration::days(1)));
        assert_eq!(parse_duration("P1W"), Some(ChronoDuration::weeks(1)));
    }
}
