//! Keeps passwords, API keys and tokens out of the clipboard history.
//!
//! Two signals: password managers mark what they copy with Windows' private
//! clipboard formats, and secrets have recognisable shapes (provider prefixes,
//! private key blocks, JWTs, or one long random-looking word).

use windows::core::w;
use windows::Win32::System::DataExchange::{IsClipboardFormatAvailable, RegisterClipboardFormatW};

/// Prefixes used by common API keys and tokens.
const PREFIXES: [&str; 22] = [
    "sk-", "sk_live_", "sk_test_", "rk_live_", "gsk_", "AIza", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_",
    "glpat-", "xoxb-", "xoxp-", "xoxa-", "xoxs-", "hf_", "AKIA", "ASIA", "npm_", "pypi-",
];

/// The clipboard says "do not keep me" (KeePass, Bitwarden, 1Password, Windows' own password fields).
pub(crate) fn clipboard_marked_private() -> bool {
    unsafe {
        // Its presence alone means "clipboard monitors, skip this".
        let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
        exclude != 0 && IsClipboardFormatAvailable(exclude).is_ok()
    }
}

/// Bits of information per character; random keys sit well above prose and ids.
fn entropy(text: &str) -> f64 {
    let mut counts = std::collections::HashMap::new();
    let total = text.chars().count() as f64;
    for c in text.chars() {
        *counts.entry(c).or_insert(0usize) += 1;
    }
    counts.values().map(|&count| {
        let p = count as f64 / total;
        -p * p.log2()
    }).sum()
}

pub(crate) fn looks_secret(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.contains("-----BEGIN") && trimmed.contains("PRIVATE KEY-----") {
        return true;
    }
    // Secrets are a single word; sentences, paths and lists are not.
    if trimmed.is_empty() || trimmed.chars().any(char::is_whitespace) || trimmed.len() > 512 {
        return false;
    }
    if trimmed.len() >= 16 && PREFIXES.iter().any(|prefix| trimmed.starts_with(prefix)) {
        return true;
    }
    // JSON Web Tokens: three base64url parts, the first two starting with "eyJ".
    let parts: Vec<&str> = trimmed.split('.').collect();
    if parts.len() == 3 && parts[0].starts_with("eyJ") && parts[1].starts_with("eyJ") && trimmed.len() > 60 {
        return true;
    }
    // A long random-looking word: mixed case, digits and high entropy, but not a link or a path.
    if trimmed.contains("://") || trimmed.contains('\\') || trimmed.contains('/') || trimmed.contains('@') || trimmed.ends_with(".com") {
        return false;
    }
    let length = trimmed.chars().count();
    let upper = trimmed.chars().any(|c| c.is_ascii_uppercase());
    let lower = trimmed.chars().any(|c| c.is_ascii_lowercase());
    let digit = trimmed.chars().any(|c| c.is_ascii_digit());
    let symbol = trimmed.chars().any(|c| !c.is_ascii_alphanumeric());
    let classes = [upper, lower, digit, symbol].iter().filter(|&&on| on).count();
    (24..=256).contains(&length) && classes >= 3 && entropy(trimmed) >= 4.2
        // Shorter passwords give themselves away with symbols mixed in.
        || (10..24).contains(&length) && classes == 4 && entropy(trimmed) >= 3.3
}

fn digits(text: &str) -> Option<Vec<u32>> {
    let trimmed = text.trim();
    if trimmed.is_empty() || !trimmed.chars().all(|c| c.is_ascii_digit() || matches!(c, ' ' | '.' | '-' | '/')) {
        return None;
    }
    Some(trimmed.chars().filter_map(|c| c.to_digit(10)).collect())
}

/// A Brazilian CPF with valid check digits.
fn is_cpf(text: &str) -> bool {
    let Some(d) = digits(text) else { return false };
    if d.len() != 11 || d.iter().all(|&x| x == d[0]) {
        return false;
    }
    let check = |count: usize| {
        let sum: u32 = (0..count).map(|i| d[i] * (count as u32 + 1 - i as u32)).sum();
        let rest = (sum * 10) % 11;
        if rest == 10 { 0 } else { rest }
    };
    check(9) == d[9] && check(10) == d[10]
}

/// A payment card number (13 to 19 digits passing the Luhn check).
fn is_card(text: &str) -> bool {
    let Some(d) = digits(text) else { return false };
    if !(13..=19).contains(&d.len()) || d.iter().all(|&x| x == d[0]) {
        return false;
    }
    let sum: u32 = d
        .iter()
        .rev()
        .enumerate()
        .map(|(i, &x)| if i % 2 == 1 { let y = x * 2; if y > 9 { y - 9 } else { y } } else { x })
        .sum();
    sum.is_multiple_of(10)
}

/// What kind of private thing this is, if any: kept out of history and worth a warning.
pub(crate) fn sensitive_kind(text: &str) -> Option<&'static str> {
    if looks_secret(text) {
        Some("secret")
    } else if is_cpf(text) {
        Some("cpf")
    } else if is_card(text) {
        Some("card")
    } else {
        None
    }
}

/// Empties the clipboard, but only while it still holds the private thing.
#[tauri::command]
pub(crate) fn clear_sensitive_clipboard() -> Result<bool, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|error| error.to_string())?;
    let still_private = clipboard.get_text().ok().is_some_and(|text| sensitive_kind(&text).is_some());
    if still_private {
        clipboard.clear().map_err(|error| error.to_string())?;
    }
    Ok(still_private)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpf_and_cards_are_recognised() {
        assert_eq!(sensitive_kind("529.982.247-25"), Some("cpf"));
        assert_eq!(sensitive_kind("52998224725"), Some("cpf"));
        assert_eq!(sensitive_kind("529.982.247-24"), None);
        assert_eq!(sensitive_kind("111.111.111-11"), None);
        assert_eq!(sensitive_kind("4111 1111 1111 1111"), Some("card"));
        assert_eq!(sensitive_kind("5555-5555-5555-4444"), Some("card"));
        assert_eq!(sensitive_kind("4111 1111 1111 1112"), None);
        assert_eq!(sensitive_kind("(11) 98765-4321"), None);
        assert_eq!(sensitive_kind("2026"), None);
    }

    #[test]
    fn keys_tokens_and_passwords_are_caught() {
        assert!(looks_secret("gsk_FAKEtestKEY0000000000000000000000000000000"));
        assert!(looks_secret("sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789"));
        assert!(looks_secret("AIzaSyA1234567890abcdefghijklmnopqrstuv"));
        assert!(looks_secret("ghp_1234567890abcdefghijABCDEFGHIJ123456"));
        assert!(looks_secret("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"));
        assert!(looks_secret("-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----"));
        assert!(looks_secret("Tr0ub4dor&3xK!q"));
        assert!(looks_secret("q8Zr2LxP0vWm7NtY4bKc9HsJ1dFgE6aQ"));
    }

    #[test]
    fn everyday_copies_are_kept() {
        for text in [
            "Bom dia! Tudo bem?",
            "https://github.com/EduardoxDev/Nimbo",
            "C:\\Users\\psico\\Downloads",
            "eduardo@example.com",
            "Rua Augusta, 1500 - São Paulo",
            "NB123456789BR",
            "#ff375f",
            "RelatorioFinal2026",
            "12345678",
            "use std::time::Duration;",
        ] {
            assert!(!looks_secret(text), "{text}");
        }
    }
}
