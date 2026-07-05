//! Jarvis local backend.
//!
//! Thin, secure bridge between the Tauri webview and the LLM providers / Jarvis
//! agent server. NO secrets are ever hardcoded — everything is read from the
//! environment (loaded from `.env` via dotenvy on startup).
//!
//! The provider is auto-detected from the key prefix, so the same code works
//! with a native Anthropic key (`sk-ant-…`) or an OpenRouter key (`sk-or-…`).

use serde::{Deserialize, Serialize};
use serde_json::json;

/// A single chat turn, shared with the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .expect("failed to build http client")
}

fn jarvis_url() -> String {
    std::env::var("JARVIS_SERVER_URL").unwrap_or_else(|_| "http://localhost:8791".to_string())
}

/// Attach the optional shared-secret header if JARVIS_API_TOKEN is set.
fn with_token(builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    match std::env::var("JARVIS_API_TOKEN") {
        Ok(token) if !token.is_empty() => builder.header("x-jarvis-token", token),
        _ => builder,
    }
}

/// The general LLM key (OpenRouter or Anthropic), tried in order.
fn llm_key() -> Result<String, String> {
    for var in ["OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"] {
        if let Ok(k) = std::env::var(var) {
            if !k.trim().is_empty() {
                return Ok(k);
            }
        }
    }
    Err("Define OPENROUTER_API_KEY ou ANTHROPIC_API_KEY no ficheiro src-tauri/.env".to_string())
}

const OLLAMA_URL: &str = "http://localhost:11434/v1/chat/completions";

/// Local Ollama model to use (JARVIS_MODEL or a sensible default).
fn ollama_model(model: Option<String>) -> String {
    model
        .or_else(|| std::env::var("JARVIS_MODEL").ok())
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| "llama3.1:8b".to_string())
}

fn json_err(body: &serde_json::Value, fallback: &str) -> String {
    body["error"]["message"]
        .as_str()
        .or_else(|| body["error"].as_str())
        .unwrap_or(fallback)
        .to_string()
}

/// Native Anthropic Messages API.
async fn anthropic_chat(key: &str, model: &str, messages: Vec<ChatMessage>) -> Result<String, String> {
    let res = http()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({ "model": model, "max_tokens": 4096, "messages": messages }))
        .send()
        .await
        .map_err(|e| format!("Falha de rede (Anthropic): {e}"))?;
    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Resposta inválida (Anthropic): {e}"))?;
    if !status.is_success() {
        return Err(json_err(&body, "Erro da API Anthropic"));
    }
    Ok(body["content"][0]["text"].as_str().unwrap_or_default().to_string())
}

/// OpenAI-compatible chat completions (used by OpenRouter and OpenAI).
async fn openai_compatible_chat(
    base_url: &str,
    key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
    provider_name: &str,
) -> Result<String, String> {
    let res = http()
        .post(base_url)
        .header("Authorization", format!("Bearer {key}"))
        .header("X-Title", "Jarvis")
        .json(&json!({ "model": model, "max_tokens": 4096, "messages": messages }))
        .send()
        .await
        .map_err(|e| format!("Falha de rede ({provider_name}): {e}"))?;
    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Resposta inválida ({provider_name}): {e}"))?;
    if !status.is_success() {
        return Err(json_err(&body, &format!("Erro da API {provider_name}")));
    }
    Ok(body["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or_default()
        .to_string())
}

/// Direct call to a Claude model — native Anthropic or via OpenRouter, by key prefix.
#[tauri::command]
async fn ask_claude(messages: Vec<ChatMessage>, model: Option<String>) -> Result<String, String> {
    if messages.is_empty() {
        return Err("Sem mensagens para enviar.".to_string());
    }
    match llm_key() {
        Ok(key) if key.starts_with("sk-ant") => {
            let model = model.unwrap_or_else(|| "claude-opus-4-8".to_string());
            anthropic_chat(&key, &model, messages).await
        }
        Ok(key) if key.starts_with("sk-or") => {
            let model =
                model.unwrap_or_else(|| "meta-llama/llama-3.3-70b-instruct:free".to_string());
            openai_compatible_chat(
                "https://openrouter.ai/api/v1/chat/completions",
                &key,
                &model,
                messages,
                "OpenRouter",
            )
            .await
        }
        // No cloud key → local Ollama.
        _ => {
            let model = ollama_model(model);
            openai_compatible_chat(OLLAMA_URL, "ollama", &model, messages, "Ollama").await
        }
    }
}

/// Direct call to a GPT model — needs an OpenRouter key (sk-or) or an OpenAI key.
#[tauri::command]
async fn ask_openai(messages: Vec<ChatMessage>, model: Option<String>) -> Result<String, String> {
    if messages.is_empty() {
        return Err("Sem mensagens para enviar.".to_string());
    }
    // Prefer an OpenRouter key (works for GPT too).
    if let Ok(key) = llm_key() {
        if key.starts_with("sk-or") {
            // Free default; troca para "openai/gpt-4o" se carregares saldo na OpenRouter.
            let model = model.unwrap_or_else(|| "meta-llama/llama-3.3-70b-instruct:free".to_string());
            return openai_compatible_chat(
                "https://openrouter.ai/api/v1/chat/completions",
                &key,
                &model,
                messages,
                "OpenRouter",
            )
            .await;
        }
    }
    // A native OpenAI key, if present.
    if let Ok(key) = std::env::var("OPENAI_API_KEY") {
        if !key.trim().is_empty() {
            let model = model.unwrap_or_else(|| "gpt-4o".to_string());
            return openai_compatible_chat(
                "https://api.openai.com/v1/chat/completions",
                &key,
                &model,
                messages,
                "OpenAI",
            )
            .await;
        }
    }
    // No cloud key → local Ollama.
    let model = ollama_model(model);
    openai_compatible_chat(OLLAMA_URL, "ollama", &model, messages, "Ollama").await
}

/// Talk to the Jarvis multi-agent server (the cloud brain).
#[tauri::command]
async fn jarvis_agent(message: String, session_id: Option<String>) -> Result<String, String> {
    let url = jarvis_url();
    let session_id = session_id.unwrap_or_else(|| "default".to_string());

    let res = with_token(
        http()
            .post(format!("{url}/chat"))
            .json(&json!({ "message": message, "sessionId": session_id })),
    )
    .send()
    .await
    .map_err(|e| format!("Servidor Jarvis inacessível em {url}: {e}"))?;

    let status = res.status();
    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("Resposta inválida do servidor Jarvis: {e}"))?;

    if !status.is_success() {
        return Err(body["error"]
            .as_str()
            .unwrap_or("Erro do servidor Jarvis")
            .to_string());
    }

    Ok(body["reply"].as_str().unwrap_or_default().to_string())
}

/// Clear the conversation memory of a session on the Jarvis server.
#[tauri::command]
async fn jarvis_reset(session_id: Option<String>) -> Result<bool, String> {
    let url = jarvis_url();
    let session_id = session_id.unwrap_or_else(|| "default".to_string());

    let res = with_token(
        http()
            .post(format!("{url}/reset"))
            .json(&json!({ "sessionId": session_id })),
    )
    .send()
    .await
    .map_err(|e| format!("Servidor Jarvis inacessível em {url}: {e}"))?;

    Ok(res.status().is_success())
}

/// Health probe used by the UI to show whether the cloud brain is online.
#[tauri::command]
async fn jarvis_health() -> Result<bool, String> {
    let url = jarvis_url();
    match http().get(format!("{url}/health")).send().await {
        Ok(r) => Ok(r.status().is_success()),
        Err(_) => Ok(false),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load .env from the working dir or any parent. Silent if absent.
    let _ = dotenvy::dotenv();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            ask_claude,
            ask_openai,
            jarvis_agent,
            jarvis_reset,
            jarvis_health
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
