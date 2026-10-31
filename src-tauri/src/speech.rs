use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};
use windows::{
    core::HSTRING,
    Foundation::{TimeSpan, TypedEventHandler},
    Globalization::Language,
    Media::SpeechRecognition::{
        SpeechContinuousRecognitionResultGeneratedEventArgs, SpeechContinuousRecognitionSession, SpeechRecognitionConfidence,
        SpeechRecognitionListConstraint, SpeechRecognitionResultStatus, SpeechRecognizer, SpeechRecognizerState,
    },
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
};
use windows_collections::IIterable;
use windows_future::AsyncStatus;

const PRIVACY_DECLINED: i32 = 0x8004_5509_u32 as i32;
const MICROPHONE_DENIED: i32 = 0x8007_0005_u32 as i32;
const NO_MICROPHONE: i32 = 0x8004_5508_u32 as i32;

static LISTENING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);
static WAKE_ENABLED: AtomicBool = AtomicBool::new(false);
static WAKE_RUNNING: AtomicBool = AtomicBool::new(false);

const WAKE_PHRASES: [&str; 4] = ["ei nimbo", "oi nimbo", "hey nimbo", "嘿 nimbo"];
const WAKE_COOLDOWN: Duration = Duration::from_secs(4);

fn seconds(value: f64) -> TimeSpan {
    TimeSpan { Duration: (value * 10_000_000.0) as i64 }
}

pub(crate) fn error_message(code: i32) -> String {
    match code {
        PRIVACY_DECLINED => "Ligue o \"Reconhecimento de fala online\" em Configurações > Privacidade e segurança > Fala.".to_string(),
        MICROPHONE_DENIED => "O Windows bloqueou o microfone. Libere \"Permitir que aplicativos da área de trabalho acessem o microfone\" em Configurações > Privacidade e segurança > Microfone.".to_string(),
        NO_MICROPHONE => "Não achei um microfone ligado.".to_string(),
        other => format!("O reconhecimento de fala falhou (0x{:08X}).", other as u32),
    }
}

fn recognizer(language: &str) -> windows::core::Result<SpeechRecognizer> {
    Language::CreateLanguage(&HSTRING::from(language))
        .and_then(|tag| SpeechRecognizer::Create(&tag))
        .or_else(|_| SpeechRecognizer::new())
}

fn listen(language: &str) -> Result<String, String> {
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let fail = |error: windows::core::Error| error_message(error.code().0);
    let recognizer = recognizer(language).map_err(fail)?;
    let timeouts = recognizer.Timeouts().map_err(fail)?;
    let _ = timeouts.SetInitialSilenceTimeout(seconds(6.0));
    let _ = timeouts.SetEndSilenceTimeout(seconds(1.2));
    let _ = timeouts.SetBabbleTimeout(seconds(20.0));
    recognizer.CompileConstraintsAsync().and_then(|operation| operation.get()).map_err(fail)?;
    let operation = recognizer.RecognizeAsync().map_err(fail)?;
    loop {
        match operation.Status().map_err(fail)? {
            AsyncStatus::Completed => break,
            AsyncStatus::Canceled => return Ok(String::new()),
            AsyncStatus::Error => return Err(error_message(operation.ErrorCode().map(|code| code.0).unwrap_or(0))),
            _ => {
                if CANCEL.load(Ordering::SeqCst) {
                    let _ = operation.Cancel();
                    if recognizer.State().map(|state| state != SpeechRecognizerState::Idle).unwrap_or(false) {
                        thread::sleep(Duration::from_millis(100));
                    }
                    return Ok(String::new());
                }
                thread::sleep(Duration::from_millis(60));
            }
        }
    }
    let result = operation.GetResults().map_err(fail)?;
    match result.Status().map_err(fail)? {
        SpeechRecognitionResultStatus::Success => Ok(result.Text().map(|text| text.to_string()).unwrap_or_default().trim().to_string()),
        SpeechRecognitionResultStatus::TimeoutExceeded | SpeechRecognitionResultStatus::UserCanceled => Ok(String::new()),
        SpeechRecognitionResultStatus::MicrophoneUnavailable => Err(error_message(NO_MICROPHONE)),
        SpeechRecognitionResultStatus::NetworkFailure => Err("Sem internet para reconhecer a fala.".to_string()),
        _ => Err("Não entendi. Tente de novo.".to_string()),
    }
}

pub(crate) fn is_wake_phrase(text: &str) -> bool {
    let clean = text.to_lowercase().replace(|c: char| !c.is_alphanumeric() && !c.is_whitespace(), "");
    clean.split_whitespace().any(|word| word == "nimbo")
}

fn start_session(language: &str, app: AppHandle) -> windows::core::Result<(SpeechRecognizer, SpeechContinuousRecognitionSession)> {
    let recognizer = recognizer(language)?;
    let phrases: Vec<HSTRING> = WAKE_PHRASES.iter().map(|phrase| HSTRING::from(*phrase)).collect();
    let constraint = SpeechRecognitionListConstraint::Create(&IIterable::<HSTRING>::from(phrases))?;
    recognizer.Constraints()?.Append(&constraint)?;
    recognizer.CompileConstraintsAsync()?.get()?;
    let session = recognizer.ContinuousRecognitionSession()?;
    let last = std::sync::Mutex::new(Instant::now() - WAKE_COOLDOWN);
    session.ResultGenerated(&TypedEventHandler::<SpeechContinuousRecognitionSession, SpeechContinuousRecognitionResultGeneratedEventArgs>::new(
        move |_, args| {
            let Some(args) = args.as_ref() else { return Ok(()) };
            let result = args.Result()?;
            let confident = matches!(result.Confidence()?, SpeechRecognitionConfidence::High | SpeechRecognitionConfidence::Medium);
            if confident && is_wake_phrase(&result.Text()?.to_string()) {
                if let Ok(mut moment) = last.lock() {
                    if moment.elapsed() >= WAKE_COOLDOWN {
                        *moment = Instant::now();
                        let _ = app.emit("wake-word", ());
                    }
                }
            }
            Ok(())
        },
    ))?;
    session.StartAsync()?.get()?;
    Ok((recognizer, session))
}

fn wake_loop(app: AppHandle, language: String) {
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let mut active: Option<(SpeechRecognizer, SpeechContinuousRecognitionSession)> = None;
    let mut retry_at = Instant::now();
    while WAKE_ENABLED.load(Ordering::SeqCst) {
        let paused = LISTENING.load(Ordering::SeqCst);
        if paused {
            if let Some((_, session)) = active.take() {
                let _ = session.CancelAsync().and_then(|operation| operation.get());
            }
        } else if active.is_none() && Instant::now() >= retry_at {
            match start_session(&language, app.clone()) {
                Ok(pair) => active = Some(pair),
                Err(error) => {
                    let _ = app.emit("wake-word-error", error_message(error.code().0));
                    retry_at = Instant::now() + Duration::from_secs(30);
                }
            }
        }
        thread::sleep(Duration::from_millis(250));
    }
    if let Some((_, session)) = active.take() {
        let _ = session.CancelAsync().and_then(|operation| operation.get());
    }
    WAKE_RUNNING.store(false, Ordering::SeqCst);
}

#[tauri::command]
pub(crate) fn speech_wake(app: AppHandle, enabled: bool, language: String) {
    WAKE_ENABLED.store(enabled, Ordering::SeqCst);
    if enabled && !WAKE_RUNNING.swap(true, Ordering::SeqCst) {
        thread::spawn(move || wake_loop(app, language));
    }
}

#[tauri::command]
pub(crate) async fn speech_listen(language: String) -> Result<String, String> {
    if LISTENING.swap(true, Ordering::SeqCst) {
        return Err("Já estou ouvindo.".to_string());
    }
    CANCEL.store(false, Ordering::SeqCst);
    let result = tauri::async_runtime::spawn_blocking(move || listen(&language)).await.map_err(|error| error.to_string());
    LISTENING.store(false, Ordering::SeqCst);
    result?
}

#[tauri::command]
pub(crate) fn speech_cancel() {
    CANCEL.store(true, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_phrases_with_the_name_wake_nimbo() {
        assert!(is_wake_phrase("Ei, Nimbo!"));
        assert!(is_wake_phrase("hey nimbo"));
        assert!(!is_wake_phrase("ei limbo"));
    }

    #[test]
    fn known_errors_explain_the_fix() {
        assert!(error_message(PRIVACY_DECLINED).contains("Fala"));
        assert!(error_message(MICROPHONE_DENIED).contains("Microfone"));
        assert!(error_message(0x1234).contains("0x00001234"));
        assert_eq!(seconds(1.5).Duration, 15_000_000);
    }
}
