use anyhow::Result;
use serde::{Deserialize, Serialize};
use tokio::io::{self, AsyncBufReadExt, AsyncWriteExt, BufReader};

#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
enum Request {
    #[serde(rename = "send")]
    Send { #[serde(rename = "chatId")] chat_id: String, text: String },
}

#[derive(Debug, Serialize)]
struct Event<'a> {
    event: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<&'a str>,
}

async fn emit(event: Event<'_>) -> Result<()> {
    let mut out = io::stdout();
    let line = serde_json::to_vec(&event)?;
    out.write_all(&line).await?;
    out.write_all(b"\n").await?;
    out.flush().await?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    emit(Event {
        event: "ready".to_string(),
        message: None,
        error: None,
    }).await?;

    let stdin = io::stdin();
    let mut lines = BufReader::new(stdin).lines();

    while let Some(line) = lines.next_line().await? {
        let request: Request = match serde_json::from_str(&line) {
            Ok(request) => request,
            Err(err) => {
                emit(Event {
                    event: "error".to_string(),
                    message: None,
                    error: Some(Box::leak(format!("invalid request: {err}").into_boxed_str())),
                }).await?;
                continue;
            }
        };

        match request {
            Request::Send { chat_id, .. } => {
                eprintln!("[sidecar] send requested for chat {chat_id}; direct iMessage backend is not enabled yet");
                emit(Event {
                    event: "error",
                    message: None,
                    error: Some("direct iMessage backend is not enabled"),
                }).await?;
            }
        }
    }

    Ok(())
}
