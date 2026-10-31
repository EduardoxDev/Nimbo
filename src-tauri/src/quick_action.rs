use std::{
    io::{Read, Write},
    os::windows::process::CommandExt,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const CREATE_NO_WINDOW: u32 = 0x08000000;
const MAX_INPUT_CHARS: usize = 20_000;
const TIMEOUT: Duration = Duration::from_secs(90);

pub(crate) fn prompt_for(action: &str, text: &str, language: &str) -> Result<String, String> {
    let target = match language {
        "en" => "English",
        "zh-CN" => "Simplified Chinese",
        _ => "Brazilian Portuguese",
    };
    let instruction = match action {
        "summarize" => format!("Summarize the text below in at most three short sentences, written in {target}. Reply with the summary only."),
        "translate" => format!("Translate the text below into {target}. If it is already in {target}, translate it into English instead. Reply with the translation only."),
        _ => return Err("Ação desconhecida.".to_string()),
    };
    let clipped: String = text.chars().take(MAX_INPUT_CHARS).collect();
    if clipped.trim().is_empty() {
        return Err("O item está vazio.".to_string());
    }
    Ok(format!("{instruction}\n\n<text>\n{clipped}\n</text>"))
}

fn run(prompt: String) -> Result<String, String> {
    let exe = crate::claude_task::executable().ok_or("Não achei o Claude Code neste PC.")?;
    let mut child = Command::new(exe)
        .creation_flags(CREATE_NO_WINDOW)
        .args(["-p", "--model", "haiku", "--output-format", "text", "--no-session-persistence", "--tools", ""])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).map_err(|error| error.to_string())?;
    }
    let mut stdout = child.stdout.take().ok_or("Sem resposta do Claude.")?;
    let reader = thread::spawn(move || {
        let mut output = String::new();
        let _ = stdout.read_to_string(&mut output);
        output
    });
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        if started.elapsed() > TIMEOUT {
            let _ = child.kill();
            return Err("O Claude demorou demais para responder.".to_string());
        }
        thread::sleep(Duration::from_millis(200));
    };
    let output = reader.join().unwrap_or_default().trim().to_string();
    if !status.success() || output.is_empty() {
        return Err("O Claude não conseguiu responder agora.".to_string());
    }
    Ok(output)
}

#[tauri::command]
pub(crate) async fn clipboard_ai_action(action: String, text: String, language: String) -> Result<String, String> {
    let prompt = prompt_for(&action, &text, &language)?;
    let answer = tauri::async_runtime::spawn_blocking(move || run(prompt)).await.map_err(|error| error.to_string())??;
    crate::clipboard_history::write_clipboard_text(&answer)?;
    Ok(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_follow_the_action_and_language() {
        let summary = prompt_for("summarize", "um texto", "pt-BR").unwrap();
        assert!(summary.contains("Brazilian Portuguese") && summary.contains("<text>\num texto\n</text>"));
        assert!(prompt_for("translate", "hi", "zh-CN").unwrap().contains("Simplified Chinese"));
        assert!(prompt_for("delete", "x", "en").is_err());
        assert!(prompt_for("summarize", "   ", "en").is_err());
    }
}
