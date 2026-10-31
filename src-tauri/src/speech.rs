use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::Duration,
};
use windows::{
    core::HSTRING,
    Foundation::TimeSpan,
    Globalization::Language,
    Media::SpeechRecognition::{SpeechRecognitionResultStatus, SpeechRecognizer, SpeechRecognizerState},
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
};
use windows_future::AsyncStatus;

const PRIVACY_DECLINED: i32 = 0x8004_5509_u32 as i32;
const MICROPHONE_DENIED: i32 = 0x8007_0005_u32 as i32;
const NO_MICROPHONE: i32 = 0x8004_5508_u32 as i32;

static LISTENING: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

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
    fn known_errors_explain_the_fix() {
        assert!(error_message(PRIVACY_DECLINED).contains("Fala"));
        assert!(error_message(MICROPHONE_DENIED).contains("Microfone"));
        assert!(error_message(0x1234).contains("0x00001234"));
        assert_eq!(seconds(1.5).Duration, 15_000_000);
    }
}
