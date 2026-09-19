#[cfg(not(all(target_os = "linux", target_arch = "x86_64")))]
compile_error!("direct-imessage backend targets Linux x86_64 only");

use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};

use anyhow::{anyhow, Context, Result};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rpassword::prompt_password;
use rustpush::macos::MacOSConfig;
use rustpush::{
    authenticate_apple, default_provider, login_apple_delegates, register, APSConnectionResource,
    APSState, AppleAccount, ConversationData, IDSNGMIdentity, IDSUser, IMClient, LoginDelegate,
    Message, MessageInst, MessagePart, MessageType, NormalMessage, OSConfig, ResourceState,
    FACETIME_SERVICE, MADRID_SERVICE, MULTIPLEX_SERVICE, VIDEO_SERVICE,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const DEFAULT_HWCONFIG: &str = "hwconfig.plist";
const DEFAULT_STATE: &str = "imessage-state.plist";
const DEFAULT_ANISETTE: &str = "anisette";
const DEFAULT_ATTACHMENT_DIR: &str = "attachments";
const DEFAULT_MAX_ATTACHMENT_MB: u64 = 100;
const DEFAULT_MAX_ATTACHMENTS: usize = 10;
const DEFAULT_ATTACHMENT_MAX_AGE_HOURS: u64 = 24;

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SavedState {
    push: APSState,
    users: Vec<IDSUser>,
    identity: IDSNGMIdentity,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "action")]
enum Request {
    #[serde(rename = "send")]
    Send {
        #[serde(rename = "chatId")]
        chat_id: String,
        text: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "event")]
enum Event {
    #[serde(rename = "ready")]
    Ready,
    #[serde(rename = "status")]
    Status { connected: bool },
    #[serde(rename = "message")]
    Message { message: NormalizedMessage },
    #[serde(rename = "sent")]
    Sent {
        id: String,
        #[serde(rename = "chatId")]
        chat_id: String,
    },
    #[serde(rename = "error")]
    Error { error: String },
}

#[derive(Debug, Serialize)]
struct NormalizedMessage {
    id: String,
    #[serde(rename = "chatId")]
    chat_id: String,
    sender: Option<String>,
    #[serde(rename = "chatName")]
    chat_name: Option<String>,
    #[serde(rename = "isGroup")]
    is_group: bool,
    service: &'static str,
    text: String,
    attachments: Vec<Attachment>,
}

#[derive(Debug, Serialize)]
struct Attachment {
    path: String,
    name: String,
    #[serde(rename = "mimeType")]
    mime_type: Option<String>,
}

fn env_path(name: &str, default: &str) -> PathBuf {
    std::env::var_os(name)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(default))
}

fn save_state(path: &PathBuf, state: &SavedState) -> Result<()> {
    let tmp = path.with_extension("tmp");
    let file = std::fs::File::create(&tmp)
        .with_context(|| format!("creating temporary state {}", tmp.display()))?;
    plist::to_writer_xml(file, state)
        .with_context(|| format!("writing state {}", tmp.display()))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o600))?;
    }

    std::fs::rename(&tmp, path).with_context(|| format!("installing state {}", path.display()))?;
    Ok(())
}

fn load_state(path: &PathBuf) -> Result<SavedState> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("opening saved state {}", path.display()))?;
    plist::from_reader_xml(file).context("decoding saved rustpush state")
}

fn load_config(path: &PathBuf) -> Result<Arc<MacOSConfig>> {
    let file = std::fs::File::open(path)
        .with_context(|| format!("opening hardware config {}", path.display()))?;
    let config: MacOSConfig =
        plist::from_reader_xml(file).context("decoding MacOSConfig hardware data")?;
    Ok(Arc::new(config))
}

fn chat_id_from_participants(
    participants: &[String],
    self_handles: &[String],
    is_sms: bool,
) -> String {
    let mut filtered: Vec<String> = participants
        .iter()
        .filter(|participant| !self_handles.contains(participant))
        .cloned()
        .collect();
    filtered.sort();
    let encoded = URL_SAFE_NO_PAD.encode(filtered.join("\n"));
    let prefix = if is_sms { "sms:" } else { "imsg:" };
    format!("{prefix}{encoded}")
}

fn participants_from_chat_id(chat_id: &str) -> Result<(Vec<String>, bool)> {
    let (encoded, is_sms) = if let Some(encoded) = chat_id.strip_prefix("imsg:") {
        (encoded, false)
    } else if let Some(encoded) = chat_id.strip_prefix("sms:") {
        (encoded, true)
    } else {
        return Err(anyhow!("unsupported chatId format"));
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(encoded)
        .context("invalid encoded chatId")?;
    let decoded = String::from_utf8(bytes).context("chatId is not UTF-8")?;
    let participants: Vec<String> = decoded
        .split('\n')
        .filter(|participant| !participant.is_empty())
        .map(str::to_owned)
        .collect();

    if participants.is_empty() {
        return Err(anyhow!("chatId contains no recipients"));
    }

    Ok((participants, is_sms))
}

fn env_u64(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn attachment_cache_dir() -> PathBuf {
    env_path("IMSG_RUSTPUSH_ATTACHMENT_DIR", DEFAULT_ATTACHMENT_DIR)
}

fn sanitize_filename(name: &str, fallback: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(fallback);

    let sanitized: String = base
        .chars()
        .map(|ch| {
            if ch.is_control() || matches!(ch, '/' | '\\') {
                '_'
            } else {
                ch
            }
        })
        .collect();

    if sanitized.is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}

fn sanitize_id(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_') {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn cleanup_attachment_cache(dir: &Path) -> Result<()> {
    fs::create_dir_all(dir)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    let max_age = Duration::from_secs(
        env_u64(
            "IMSG_RUSTPUSH_ATTACHMENT_MAX_AGE_HOURS",
            DEFAULT_ATTACHMENT_MAX_AGE_HOURS,
        ) * 3600,
    );
    let now = SystemTime::now();

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let metadata = entry.metadata()?;
        if !metadata.is_file() {
            continue;
        }
        let modified = metadata.modified().unwrap_or(now);
        if now.duration_since(modified).unwrap_or_default() > max_age {
            let _ = fs::remove_file(entry.path());
        }
    }

    Ok(())
}

async fn save_incoming_attachments(
    connection: &rustpush::APSConnection,
    message_id: &str,
    normal: &NormalMessage,
) -> Result<Vec<Attachment>> {
    let dir = attachment_cache_dir();
    fs::create_dir_all(&dir)?;
    let max_bytes = env_u64("IMSG_RUSTPUSH_MAX_ATTACHMENT_MB", DEFAULT_MAX_ATTACHMENT_MB)
        .saturating_mul(1024 * 1024);
    let mut attachments = Vec::new();
    let max_attachments = env_u64(
        "IMSG_RUSTPUSH_MAX_ATTACHMENTS",
        DEFAULT_MAX_ATTACHMENTS as u64,
    ) as usize;

    for (index, part) in normal.parts.0.iter().enumerate() {
        if max_attachments != 0 && attachments.len() >= max_attachments {
            break;
        }
        let MessagePart::Attachment(attachment) = &part.part else {
            continue;
        };

        let size = attachment.get_size() as u64;
        if max_bytes != 0 && size > max_bytes {
            eprintln!(
                "[rustpush] skipping attachment {} ({} bytes exceeds {} bytes)",
                attachment.name, size, max_bytes
            );
            continue;
        }

        let fallback = format!("attachment-{index}");
        let name = sanitize_filename(&attachment.name, &fallback);
        let filename = format!("{}_{}_{}", sanitize_id(message_id), index, name);
        let path = dir.join(filename);
        let file = match fs::File::create(&path) {
            Ok(file) => file,
            Err(error) => {
                eprintln!(
                    "[rustpush] could not create attachment {}: {error}",
                    path.display()
                );
                continue;
            }
        };

        if let Err(error) = attachment
            .get_attachment(connection.resource.as_ref(), file, |_done, _total| {})
            .await
        {
            eprintln!(
                "[rustpush] could not download attachment {}: {error}",
                attachment.name
            );
            let _ = fs::remove_file(&path);
            continue;
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(error) = fs::set_permissions(&path, fs::Permissions::from_mode(0o600)) {
                eprintln!(
                    "[rustpush] could not protect attachment {}: {error}",
                    path.display()
                );
                let _ = fs::remove_file(&path);
                continue;
            }
        }

        attachments.push(Attachment {
            path: path.to_string_lossy().into_owned(),
            name,
            mime_type: if attachment.mime.is_empty() {
                None
            } else {
                Some(attachment.mime.clone())
            },
        });
    }

    Ok(attachments)
}

fn sms_using_number(handles: &[String]) -> Result<String> {
    handles
        .iter()
        .find(|handle| handle.starts_with("tel:"))
        .cloned()
        .ok_or_else(|| anyhow!("no phone handle is registered for SMS sending"))
}

async fn emit(event: &Event) -> Result<()> {
    let mut stdout = tokio::io::stdout();
    let mut line = serde_json::to_vec(event)?;
    line.push(b'\n');
    stdout.write_all(&line).await?;
    stdout.flush().await?;
    Ok(())
}

fn prompt_line(prompt: &str) -> Result<String> {
    print!("{prompt}");
    io::stdout().flush()?;
    let mut input = String::new();
    io::stdin().read_line(&mut input)?;
    Ok(input.trim().to_string())
}

async fn provision() -> Result<()> {
    let hwconfig_path = env_path("IMSG_RUSTPUSH_HWCONFIG", DEFAULT_HWCONFIG);
    let state_path = env_path("IMSG_RUSTPUSH_STATE", DEFAULT_STATE);
    let anisette_path = env_path("IMSG_RUSTPUSH_ANISETTE", DEFAULT_ANISETTE);

    let config = load_config(&hwconfig_path)?;
    let (connection, error) = APSConnectionResource::new(config.clone(), None).await;
    if let Some(error) = error {
        return Err(anyhow!("APS connection setup failed: {error}"));
    }

    let anisette_client = default_provider(
        config.get_gsa_config(&*connection.state.read().await, false),
        anisette_path,
    );

    let apple_id = prompt_line("Apple ID: ")?;
    let password = prompt_password("Apple password: ")?;
    let password_hash = Sha256::digest(password.as_bytes()).to_vec();
    let credentials = (apple_id, password_hash);

    let two_factor = || -> String { prompt_line("Apple 2FA code: ").unwrap_or_default() };

    let account = AppleAccount::login(
        || credentials.clone(),
        two_factor,
        config.get_gsa_config(&*connection.state.read().await, false),
        anisette_client.clone(),
    )
    .await
    .context("Apple Account login failed")?;

    account
        .update_postdata("Apple Device", None, &["icloud", "imessage", "facetime"])
        .await
        .context("updating Apple account service metadata")?;

    let delegates = login_apple_delegates(
        &account,
        None,
        config.as_ref(),
        &[LoginDelegate::IDS, LoginDelegate::MobileMe],
    )
    .await
    .context("creating iMessage authentication delegates")?;

    let ids_delegate = delegates
        .ids
        .ok_or_else(|| anyhow!("Apple did not return an IDS delegate"))?;

    let user = authenticate_apple(ids_delegate, config.as_ref())
        .await
        .context("authenticating IDS user")?;

    let identity = IDSNGMIdentity::new().context("creating local iMessage identity")?;
    let mut users = vec![user];

    let services = &[
        &MADRID_SERVICE,
        &MULTIPLEX_SERVICE,
        &FACETIME_SERVICE,
        &VIDEO_SERVICE,
    ];

    register(
        config.as_ref(),
        &*connection.state.read().await,
        services,
        &mut users,
        &identity,
    )
    .await
    .context("registering Linux iMessage identity")?;

    let saved = SavedState {
        push: connection.state.read().await.clone(),
        users,
        identity,
    };

    save_state(&state_path, &saved)?;

    println!("Provisioning complete.");
    println!("Saved state: {}", state_path.display());
    println!("Hardware config: {}", hwconfig_path.display());

    Ok(())
}

async fn bridge() -> Result<()> {
    let hwconfig_path = env_path("IMSG_RUSTPUSH_HWCONFIG", DEFAULT_HWCONFIG);
    let state_path = env_path("IMSG_RUSTPUSH_STATE", DEFAULT_STATE);

    let config = load_config(&hwconfig_path)?;
    let saved = load_state(&state_path)?;
    cleanup_attachment_cache(&attachment_cache_dir())?;

    let (connection, error) =
        APSConnectionResource::new(config.clone(), Some(saved.push.clone())).await;

    if let Some(error) = error {
        emit(&Event::Error {
            error: format!("APS connection setup failed: {error}"),
        })
        .await?;
        return Err(anyhow!("APS connection setup failed: {error}"));
    }

    let state = Arc::new(Mutex::new(saved.clone()));
    let state_for_callback = Arc::clone(&state);
    let state_path_for_callback = state_path.clone();

    let users = saved.users.clone();
    let identity = saved.identity.clone();

    let client = IMClient::new(
        connection.clone(),
        users,
        identity,
        &[
            &MADRID_SERVICE,
            &MULTIPLEX_SERVICE,
            &FACETIME_SERVICE,
            &VIDEO_SERVICE,
        ],
        PathBuf::from("id_cache.plist"),
        config.clone(),
        Box::new(move |updated_users| {
            if let Ok(mut state) = state_for_callback.lock() {
                state.users = updated_users;
                if let Err(error) = save_state(&state_path_for_callback, &state) {
                    eprintln!("[rustpush] failed to persist users: {error:#}");
                }
            }
        }),
    )
    .await;

    let mut handles = client.identity.get_handles().await;
    emit(&Event::Ready).await?;
    emit(&Event::Status { connected: true }).await?;

    let mut subscription = connection.messages_cont.subscribe();
    let mut resource_state = connection.resource_state.subscribe();
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();

    loop {
        tokio::select! {
            line = lines.next_line() => {
                match line? {
                    Some(line) if !line.trim().is_empty() => {
                        match serde_json::from_str::<Request>(&line) {
                            Ok(Request::Send { chat_id, text }) => {
                                let (participants, is_sms) = match participants_from_chat_id(&chat_id) {
                                    Ok(value) => value,
                                    Err(error) => {
                                        emit(&Event::Error { error: error.to_string() }).await?;
                                        continue;
                                    }
                                };

                                let sender = match handles.first() {
                                    Some(sender) => sender.clone(),
                                    None => {
                                        emit(&Event::Error {
                                            error: "no registered iMessage handle".to_string(),
                                        }).await?;
                                        continue;
                                    }
                                };

                                let conversation = ConversationData {
                                    participants,
                                    cv_name: None,
                                    sender_guid: None,
                                    after_guid: None,
                                };

                                let service = if is_sms {
                                    MessageType::SMS {
                                        is_phone: false,
                                        using_number: match sms_using_number(&handles) {
                                            Ok(number) => number,
                                            Err(error) => {
                                                emit(&Event::Error { error: error.to_string() }).await?;
                                                continue;
                                            }
                                        },
                                        from_handle: None,
                                    }
                                } else {
                                    MessageType::IMessage
                                };

                                let message = NormalMessage::new(text, service);
                                let mut message = MessageInst::new(
                                    conversation,
                                    &sender,
                                    Message::Message(message),
                                );

                                match client.send(&mut message).await {
                                    Ok(_) => {
                                        emit(&Event::Sent {
                                            id: message.id,
                                            chat_id,
                                        }).await?;
                                    }
                                    Err(error) => {
                                        emit(&Event::Error {
                                            error: format!("send failed: {error}"),
                                        }).await?;
                                    }
                                }
                            }
                            Err(error) => {
                                emit(&Event::Error {
                                    error: format!("invalid request: {error}"),
                                })
                                .await?;
                            }
                        }
                    }
                    None => break,
                    _ => {}
                }
            }
            incoming = subscription.recv() => {
                match incoming {
                    Ok(aps_message) => {
                        match client.handle(aps_message).await {
                            Ok(Some(message)) if message.has_payload() => {
                                if let Message::Message(normal) = &message.message {
                                    let conversation = message.conversation.clone();
                                    let participants = conversation
                                        .as_ref()
                                        .map(|data| data.participants.clone())
                                        .unwrap_or_default();

                                    let is_sms = matches!(normal.service, MessageType::SMS { .. });
                                    let attachments =
                                        save_incoming_attachments(&connection, &message.id, normal)
                                            .await
                                            .unwrap_or_else(|error| {
                                                eprintln!(
                                                    "[rustpush] attachment processing failed: {error:#}"
                                                );
                                                Vec::new()
                                            });

                                    let normalized = NormalizedMessage {
                                        id: message.id.clone(),
                                        chat_id: chat_id_from_participants(
                                            &participants,
                                            &handles,
                                            is_sms,
                                        ),
                                        sender: message.sender.clone(),
                                        chat_name: conversation
                                            .as_ref()
                                            .and_then(|data| data.cv_name.clone()),
                                        is_group: conversation
                                            .as_ref()
                                            .map(ConversationData::is_group)
                                            .unwrap_or(false),
                                        service: if is_sms { "sms" } else { "imessage" },
                                        text: normal.parts.raw_text(),
                                        attachments,
                                    };

                                    emit(&Event::Message { message: normalized }).await?;
                                }
                            }
                            Ok(Some(_)) | Ok(None) => {}
                            Err(error) => {
                                emit(&Event::Error {
                                    error: format!("receive failed: {error}"),
                                })
                                .await?;
                            }
                        }

                        let current_push = connection.state.read().await.clone();
                        if let Ok(mut state) = state.lock() {
                            state.push = current_push;
                            if let Err(error) = save_state(&state_path, &state) {
                                eprintln!("[rustpush] failed to persist connection state: {error:#}");
                            }
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(count)) => {
                        emit(&Event::Error {
                            error: format!("incoming message buffer lagged by {count} events"),
                        })
                        .await?;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                        emit(&Event::Status { connected: false }).await?;
                        return Err(anyhow!("rustpush connection message stream closed"));
                    }
                }
            }
            state_change = resource_state.changed() => {
                state_change?;
                match resource_state.borrow_and_update().clone() {
                    ResourceState::Generated => {
                        handles = client.identity.get_handles().await;
                        let current_push = connection.state.read().await.clone();
                        if let Ok(mut state) = state.lock() {
                            state.push = current_push;
                            if let Err(error) = save_state(&state_path, &state) {
                                eprintln!("[rustpush] failed to persist reconnected state: {error:#}");
                            }
                        }
                        emit(&Event::Status { connected: true }).await?;
                    }
                    ResourceState::Generating | ResourceState::Failed(_) => {
                        emit(&Event::Status { connected: false }).await?;
                    }
                    ResourceState::Closed => {
                        emit(&Event::Status { connected: false }).await?;
                        return Err(anyhow!("rustpush APS resource closed"));
                    }
                }
            }
        }
    }

    emit(&Event::Status { connected: false }).await?;
    Ok(())
}

#[tokio::main]
async fn main() -> Result<()> {
    match std::env::args().nth(1).as_deref() {
        Some("provision") => provision().await,
        Some("bridge") | None => bridge().await,
        Some(command) => Err(anyhow!(
            "unknown command {command}; use provision or bridge"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imessage_chat_ids_round_trip_deterministically() {
        let participants = vec![
            "tel:+61422222222".to_string(),
            "tel:+61411111111".to_string(),
            "tel:+61499999999".to_string(),
        ];
        let self_handles = vec!["tel:+61499999999".to_string()];

        let chat_id = chat_id_from_participants(&participants, &self_handles, false);
        let (decoded, is_sms) = participants_from_chat_id(&chat_id).unwrap();

        assert!(!is_sms);
        assert_eq!(
            decoded,
            vec![
                "tel:+61411111111".to_string(),
                "tel:+61422222222".to_string(),
            ]
        );

        let second = chat_id_from_participants(
            &participants.iter().rev().cloned().collect::<Vec<_>>(),
            &self_handles,
            false,
        );
        assert_eq!(chat_id, second);
    }

    #[test]
    fn sms_chat_ids_keep_the_sms_namespace() {
        let participants = vec![
            "tel:+61422222222".to_string(),
            "tel:+61411111111".to_string(),
        ];

        let chat_id = chat_id_from_participants(&participants, &[], true);
        assert!(chat_id.starts_with("sms:"));

        let (decoded, is_sms) = participants_from_chat_id(&chat_id).unwrap();
        assert!(is_sms);
        assert_eq!(
            decoded,
            vec![
                "tel:+61411111111".to_string(),
                "tel:+61422222222".to_string(),
            ]
        );
    }

    #[test]
    fn invalid_chat_ids_are_rejected() {
        assert!(participants_from_chat_id("chat-1").is_err());
        assert!(participants_from_chat_id("imsg:not-base64").is_err());
        assert!(participants_from_chat_id("imsg:").is_err());
    }

    #[test]
    fn attachment_names_are_safe_for_local_paths() {
        assert_eq!(
            sanitize_filename("../../private.txt", "fallback"),
            "private.txt"
        );
        assert_eq!(
            sanitize_filename("photo\u{0000}.jpg", "fallback"),
            "photo_.jpg"
        );
        assert_eq!(sanitize_filename("", "fallback"), "fallback");
    }

    #[test]
    fn attachment_ids_are_safe_for_local_names() {
        assert_eq!(sanitize_id("A/B:C 123"), "A_B_C_123");
        assert_eq!(sanitize_id("plain-id"), "plain-id");
    }
}
