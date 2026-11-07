use std::{
    fs,
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::time::{sleep, Duration};

use crate::{net, storage::hearth_dir};

const MICROSOFT_ROOT: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
const SCOPES: &str = "XboxLive.signin offline_access";
const APP_REVIEW_URL: &str = "https://aka.ms/mce-reviewappid";

/// Bumped whenever a sign-in is started or cancelled, so an older polling loop
/// notices it has been replaced and stops quietly.
static LOGIN_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInfo {
    pub username: String,
    pub uuid: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCodeInfo {
    pub user_code: String,
    pub verification_uri: String,
    pub device_code: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthSession {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    pub account: AccountInfo,
}

#[derive(Debug, Deserialize)]
struct MicrosoftToken {
    access_token: String,
    refresh_token: Option<String>,
}

/// A failed HTTP call with the OAuth `error` code kept separately from the
/// human description. The old code matched on the description text, which
/// never contains `authorization_pending`, so sign-in failed on the first poll.
#[derive(Debug)]
struct ApiError {
    status: u16,
    code: String,
    message: String,
}

impl ApiError {
    fn text(&self) -> String {
        self.message.clone()
    }
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn account_path() -> Result<std::path::PathBuf, String> {
    Ok(hearth_dir()?.join("account.json"))
}

#[cfg(not(windows))]
fn session_path() -> Result<std::path::PathBuf, String> {
    Ok(hearth_dir()?.join("microsoft-session.json"))
}

fn validate_client_id(client_id: &str) -> Result<String, String> {
    let value = client_id.trim();
    let shape_ok = value.len() == 36
        && value.chars().enumerate().all(|(i, c)| match i {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit(),
        });
    if !shape_ok {
        return Err(
            "Enter the Application (client) ID from your Microsoft Entra app registration (format 00000000-0000-0000-0000-000000000000).".into(),
        );
    }
    if value.starts_with("00000000-0000-0000-0000-00000000") {
        return Err("That is not a real app registration ID. Copy the Application (client) ID from Microsoft Entra.".into());
    }
    Ok(value.to_string())
}

fn save_account(account: &AccountInfo) -> Result<(), String> {
    let text = serde_json::to_string_pretty(account).map_err(|e| e.to_string())?;
    fs::write(account_path()?, text).map_err(|e| format!("Could not save the account profile: {e}"))
}

pub fn current_account() -> Result<Option<AccountInfo>, String> {
    let path = account_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let text =
        fs::read_to_string(path).map_err(|e| format!("Could not read the account profile: {e}"))?;
    serde_json::from_str(&text)
        .map(Some)
        .map_err(|e| format!("The saved account profile is invalid: {e}"))
}

// Windows Credential Manager limits one secret to 2560 bytes, and keyring stores
// text as UTF-16 (1280 characters). A Minecraft token plus a Microsoft refresh
// token is longer than that, so the old single-entry save failed at the very end
// of an otherwise successful sign-in. The session is now split into chunks.
#[cfg(windows)]
const SERVICE: &str = "Hearth";
#[cfg(windows)]
const BASE_USER: &str = "microsoft-session";
#[cfg(windows)]
const CHUNK_CHARS: usize = 1000;

#[cfg(windows)]
fn entry(user: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new(SERVICE, user).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn chunk_count() -> usize {
    match entry(BASE_USER).and_then(|e| e.get_password().map_err(|e| e.to_string())) {
        Ok(value) => value
            .strip_prefix("chunks:")
            .and_then(|n| n.parse().ok())
            .unwrap_or(0),
        Err(_) => 0,
    }
}

#[cfg(windows)]
fn save_session(session: &AuthSession) -> Result<(), String> {
    let value = serde_json::to_string(session).map_err(|e| e.to_string())?;
    let chars: Vec<char> = value.chars().collect();
    let chunks: Vec<String> = chars
        .chunks(CHUNK_CHARS)
        .map(|c| c.iter().collect())
        .collect();
    let previous = chunk_count();
    for (index, chunk) in chunks.iter().enumerate() {
        entry(&format!("{BASE_USER}.{index}"))?
            .set_password(chunk)
            .map_err(|e| format!("Could not save the Microsoft session in Windows Credential Manager: {e}"))?;
    }
    for index in chunks.len()..previous {
        if let Ok(e) = entry(&format!("{BASE_USER}.{index}")) {
            let _ = e.delete_credential();
        }
    }
    entry(BASE_USER)?
        .set_password(&format!("chunks:{}", chunks.len()))
        .map_err(|e| format!("Could not save the Microsoft session in Windows Credential Manager: {e}"))
}

#[cfg(windows)]
fn load_session() -> Result<Option<AuthSession>, String> {
    let base = match entry(BASE_USER)?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => {
            return Err(format!(
                "Could not read the Microsoft session from Windows Credential Manager: {e}"
            ))
        }
    };
    let text = if let Some(count) = base.strip_prefix("chunks:") {
        let count: usize = count.parse().unwrap_or(0);
        let mut text = String::new();
        for index in 0..count {
            match entry(&format!("{BASE_USER}.{index}"))?.get_password() {
                Ok(part) => text.push_str(&part),
                Err(_) => return Ok(None),
            }
        }
        text
    } else {
        base
    };
    Ok(serde_json::from_str(&text).ok())
}

#[cfg(windows)]
fn delete_session() -> Result<(), String> {
    let count = chunk_count();
    for index in 0..count.max(8) {
        if let Ok(e) = entry(&format!("{BASE_USER}.{index}")) {
            let _ = e.delete_credential();
        }
    }
    match entry(BASE_USER)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the saved Microsoft session: {e}")),
    }
}

#[cfg(not(windows))]
fn save_session(session: &AuthSession) -> Result<(), String> {
    let value = serde_json::to_string(session).map_err(|e| e.to_string())?;
    let path = session_path()?;
    fs::write(&path, value).map_err(|e| format!("Could not save the Microsoft session: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600)).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(not(windows))]
fn load_session() -> Result<Option<AuthSession>, String> {
    let path = session_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let value = fs::read_to_string(path)
        .map_err(|e| format!("Could not read the Microsoft session: {e}"))?;
    Ok(serde_json::from_str(&value).ok())
}

#[cfg(not(windows))]
fn delete_session() -> Result<(), String> {
    let path = session_path()?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

async fn read_json(response: reqwest::Response, context: &str) -> Result<Value, ApiError> {
    let status = response.status();
    let body = response.text().await.map_err(|e| ApiError {
        status: status.as_u16(),
        code: String::new(),
        message: format!("{context}: {e}"),
    })?;
    let value: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({ "raw": body }));
    if status.is_success() {
        return Ok(value);
    }
    let code = value
        .get("error")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let description = value
        .get("error_description")
        .or_else(|| value.get("errorMessage"))
        .or_else(|| value.get("developerMessage"))
        .and_then(Value::as_str)
        .map(|text| text.lines().next().unwrap_or(text).to_string())
        .or_else(|| (!code.is_empty()).then(|| code.clone()))
        .or_else(|| {
            value
                .get("raw")
                .and_then(Value::as_str)
                .filter(|raw| !raw.trim().is_empty())
                .map(|raw| raw.chars().take(200).collect())
        })
        .unwrap_or_else(|| "The service rejected the request.".into());
    Err(ApiError {
        status: status.as_u16(),
        code,
        message: format!("{context} ({status}): {description}"),
    })
}

fn explain_microsoft_error(error: &ApiError) -> String {
    let text = &error.message;
    if text.contains("AADSTS700016") || error.code == "unauthorized_client" {
        return "Microsoft does not recognise this client ID for personal accounts. In Microsoft Entra, set Supported account types to “Personal Microsoft accounts”, then try again.".into();
    }
    if text.contains("AADSTS7000218") || text.contains("AADSTS70002") {
        return "Device sign-in is not enabled for this app. In Microsoft Entra → your app → Authentication, turn on “Allow public client flows”, save, and try again.".into();
    }
    if text.contains("AADSTS9002346") {
        return "This app registration only accepts work or school accounts. Change Supported account types to “Personal Microsoft accounts”.".into();
    }
    text.clone()
}

pub async fn begin_sign_in(client_id: String) -> Result<DeviceCodeInfo, String> {
    let client_id = validate_client_id(&client_id)?;
    LOGIN_GENERATION.fetch_add(1, Ordering::SeqCst);
    let response = net::client()
        .post(format!("{MICROSOFT_ROOT}/devicecode"))
        .form(&[("client_id", client_id.as_str()), ("scope", SCOPES)])
        .send()
        .await
        .map_err(|e| format!("Could not contact Microsoft: {e}"))?;
    let value = read_json(response, "Microsoft device sign-in")
        .await
        .map_err(|e| explain_microsoft_error(&e))?;
    Ok(DeviceCodeInfo {
        user_code: value["user_code"]
            .as_str()
            .ok_or("Microsoft did not return a user code.")?
            .into(),
        verification_uri: value["verification_uri"]
            .as_str()
            .ok_or("Microsoft did not return a verification address.")?
            .into(),
        device_code: value["device_code"]
            .as_str()
            .ok_or("Microsoft did not return a device code.")?
            .into(),
        expires_in: value["expires_in"].as_u64().unwrap_or(900),
        interval: value["interval"].as_u64().unwrap_or(5),
        message: value["message"]
            .as_str()
            .unwrap_or("Open the verification page and enter the code.")
            .into(),
    })
}

pub fn cancel_sign_in() {
    LOGIN_GENERATION.fetch_add(1, Ordering::SeqCst);
}

fn xsts_reason(xerr: Option<i64>) -> &'static str {
    match xerr {
        Some(2148916233) => "This Microsoft account has no Xbox profile yet. Sign in once at xbox.com to create one, then try again.",
        Some(2148916235) => "Xbox Live is not available in this account’s country or region.",
        Some(2148916236) | Some(2148916237) => "This account needs adult verification on the Xbox website before it can play.",
        Some(2148916238) => "This is a child account. A family organiser must add it to a Microsoft family and allow multiplayer and Xbox profile access.",
        _ => "Xbox security authorization was rejected. Check the account’s Xbox profile and privacy settings at xbox.com.",
    }
}

async fn exchange_minecraft(
    access_token: &str,
    refresh_token: String,
) -> Result<AuthSession, String> {
    let client = net::client();
    let xbl_response = client
        .post("https://user.auth.xboxlive.com/user/authenticate")
        .header("Accept", "application/json")
        .json(&json!({
            "Properties": { "AuthMethod": "RPS", "SiteName": "user.auth.xboxlive.com", "RpsTicket": format!("d={access_token}") },
            "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Could not contact Xbox Live: {e}"))?;
    let xbl = read_json(xbl_response, "Xbox Live authentication")
        .await
        .map_err(|e| e.text())?;
    let xbl_token = xbl["Token"]
        .as_str()
        .ok_or("Xbox Live did not return a token.")?;
    let user_hash = xbl["DisplayClaims"]["xui"][0]["uhs"]
        .as_str()
        .ok_or("Xbox Live did not return a user hash.")?;

    let xsts_response = client
        .post("https://xsts.auth.xboxlive.com/xsts/authorize")
        .header("Accept", "application/json")
        .json(&json!({
            "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
            "RelyingParty": "rp://api.minecraftservices.com/", "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Could not contact Xbox security services: {e}"))?;
    if xsts_response.status() == reqwest::StatusCode::UNAUTHORIZED {
        let value: Value = xsts_response.json().await.unwrap_or_default();
        return Err(xsts_reason(value["XErr"].as_i64()).into());
    }
    let xsts = read_json(xsts_response, "Xbox security authorization")
        .await
        .map_err(|e| e.text())?;
    let xsts_token = xsts["Token"]
        .as_str()
        .ok_or("Xbox did not return an XSTS token.")?;

    let minecraft_response = client
        .post("https://api.minecraftservices.com/authentication/login_with_xbox")
        .json(&json!({ "identityToken": format!("XBL3.0 x={user_hash};{xsts_token}") }))
        .send()
        .await
        .map_err(|e| format!("Could not contact Minecraft services: {e}"))?;
    let minecraft = match read_json(minecraft_response, "Minecraft authentication").await {
        Ok(value) => value,
        Err(error) if error.status == 403 => {
            return Err(format!(
                "Microsoft and Xbox sign-in worked, but Minecraft refused this app (403). New app registrations must be approved by Mojang before they can log in to Minecraft. Submit your client ID at {APP_REVIEW_URL} and try again once it is approved."
            ))
        }
        Err(error) if error.status == 429 => {
            return Err("Minecraft services are rate-limiting sign-ins right now. Wait a minute and try again.".into())
        }
        Err(error) => return Err(error.text()),
    };
    let minecraft_token = minecraft["access_token"]
        .as_str()
        .ok_or("Minecraft did not return an access token.")?
        .to_string();
    let expires_in = minecraft["expires_in"].as_u64().unwrap_or(86400);

    let entitlement_response = client
        .get("https://api.minecraftservices.com/entitlements/mcstore")
        .bearer_auth(&minecraft_token)
        .send()
        .await
        .map_err(|e| format!("Could not verify Minecraft ownership: {e}"))?;
    let entitlements = read_json(entitlement_response, "Minecraft ownership verification")
        .await
        .map_err(|e| e.text())?;
    if entitlements["items"]
        .as_array()
        .map_or(true, |items| items.is_empty())
    {
        return Err("This account does not own Minecraft: Java Edition. Hearth will not bypass ownership checks.".into());
    }

    let profile_response = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .bearer_auth(&minecraft_token)
        .send()
        .await
        .map_err(|e| format!("Could not load the Minecraft profile: {e}"))?;
    let profile = match read_json(profile_response, "Minecraft profile").await {
        Ok(value) => value,
        Err(error) if error.status == 404 => {
            return Err("This account owns Minecraft but has no player name yet. Launch the official launcher once or pick a name at minecraft.net, then try again.".into())
        }
        Err(error) => return Err(error.text()),
    };
    let account = AccountInfo {
        username: profile["name"]
            .as_str()
            .ok_or("The Minecraft profile has no player name.")?
            .into(),
        uuid: profile["id"]
            .as_str()
            .ok_or("The Minecraft profile has no UUID.")?
            .into(),
    };
    let session = AuthSession {
        access_token: minecraft_token,
        refresh_token,
        expires_at: now() + expires_in,
        account: account.clone(),
    };
    save_session(&session)?;
    save_account(&account)?;
    Ok(session)
}

pub async fn finish_sign_in(
    client_id: String,
    device_code: String,
    initial_interval: u64,
    expires_in: u64,
) -> Result<AccountInfo, String> {
    let client_id = validate_client_id(&client_id)?;
    let generation = LOGIN_GENERATION.load(Ordering::SeqCst);
    let client = net::client();
    let mut interval = initial_interval.clamp(1, 30);
    let deadline = now() + expires_in.clamp(60, 1800);
    loop {
        sleep(Duration::from_secs(interval)).await;
        if LOGIN_GENERATION.load(Ordering::SeqCst) != generation {
            return Err("Sign-in cancelled.".into());
        }
        if now() > deadline {
            return Err("The Microsoft code expired. Start sign-in again.".into());
        }
        let response = match client
            .post(format!("{MICROSOFT_ROOT}/token"))
            .form(&[
                ("client_id", client_id.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", device_code.as_str()),
            ])
            .send()
            .await
        {
            Ok(response) => response,
            // A brief network hiccup should not throw away a sign-in in progress.
            Err(_) => continue,
        };
        match read_json(response, "Microsoft token exchange").await {
            Ok(token) => {
                let token: MicrosoftToken =
                    serde_json::from_value(token).map_err(|e| e.to_string())?;
                let refresh = token.refresh_token.ok_or(
                    "Microsoft did not return a refresh token. Make sure the app allows the offline_access scope.",
                )?;
                return exchange_minecraft(&token.access_token, refresh)
                    .await
                    .map(|session| session.account);
            }
            Err(error) => match error.code.as_str() {
                "authorization_pending" => {}
                "slow_down" => interval = (interval + 5).min(30),
                "expired_token" | "code_expired" => {
                    return Err("The Microsoft code expired. Start sign-in again.".into())
                }
                "authorization_declined" | "access_denied" => {
                    return Err("Microsoft sign-in was declined.".into())
                }
                "bad_verification_code" => {
                    return Err("Microsoft did not recognise the sign-in code. Start again.".into())
                }
                _ => return Err(explain_microsoft_error(&error)),
            },
        }
    }
}

pub async fn valid_session(client_id: &str) -> Result<Option<AuthSession>, String> {
    let Some(session) = load_session()? else {
        return Ok(None);
    };
    if now() + 300 < session.expires_at {
        return Ok(Some(session));
    }
    let client_id = validate_client_id(client_id)?;
    let response = net::client()
        .post(format!("{MICROSOFT_ROOT}/token"))
        .form(&[
            ("client_id", client_id.as_str()),
            ("grant_type", "refresh_token"),
            ("refresh_token", session.refresh_token.as_str()),
            ("scope", SCOPES),
        ])
        .send()
        .await
        .map_err(|e| format!("Could not refresh the Microsoft session (are you online?): {e}"))?;
    let value = match read_json(response, "Microsoft session refresh").await {
        Ok(value) => value,
        Err(error) if error.code == "invalid_grant" || error.code == "interaction_required" => {
            // The saved session is no longer usable; ask for a fresh sign-in
            // instead of failing every launch with the same error.
            let _ = delete_session();
            return Ok(None);
        }
        Err(error) => return Err(explain_microsoft_error(&error)),
    };
    let token: MicrosoftToken = serde_json::from_value(value).map_err(|e| e.to_string())?;
    let refresh = token.refresh_token.unwrap_or(session.refresh_token);
    exchange_minecraft(&token.access_token, refresh)
        .await
        .map(Some)
}

pub fn sign_out() -> Result<(), String> {
    cancel_sign_in();
    delete_session()?;
    let path = account_path()?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| format!("Could not remove the account profile: {e}"))?;
    }
    Ok(())
}
