use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const SYSTEM_PROMPT: &str = "You are a MIDI composer engine. Generate structured MIDI note data only. Return valid JSON only. No markdown, no explanations. Create four separate MIDI tracks: arpeggiator, chords, vocal, string. Use the requested BPM, key, scale, and musical style. Notes must be musically coherent and loopable.";
const MODEL: &str = "gpt-5.2";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateMusicRequest {
    api_key: String,
    bpm: u16,
    key: String,
    scale: String,
    bars: u16,
    prompt: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiResponse {
    output_text: Option<String>,
    output: Option<Vec<OpenAiOutputItem>>,
    error: Option<OpenAiError>,
}

#[derive(Debug, Deserialize)]
struct OpenAiError {
    message: String,
}

#[derive(Debug, Deserialize)]
struct OpenAiOutputItem {
    content: Option<Vec<OpenAiContentItem>>,
}

#[derive(Debug, Deserialize)]
struct OpenAiContentItem {
    #[serde(rename = "type")]
    kind: String,
    text: Option<String>,
}

#[derive(Debug, Serialize)]
struct OpenAiTextFormat {
    #[serde(rename = "type")]
    kind: &'static str,
}

#[derive(Debug, Serialize)]
struct OpenAiTextConfig {
    format: OpenAiTextFormat,
}

#[tauri::command]
async fn generate_music_structure(request: GenerateMusicRequest) -> Result<Value, String> {
    if request.api_key.trim().is_empty() {
        return Err("Missing OpenAI API Key.".into());
    }

    let input = format!(
        "Create loopable MIDI data as JSON for a {bars}-bar composition.\nBPM: {bpm}\nKey: {key}\nScale: {scale}\nPrompt: {prompt}\nReturn JSON only with this exact top-level shape: {{\"bpm\": number, \"key\": string, \"scale\": string, \"tracks\": {{\"arpeggiator\": [{{\"note\": \"C4\", \"start\": 0, \"duration\": 0.5, \"velocity\": 90}}], \"chords\": [{{\"notes\": [\"C3\", \"E3\", \"G3\"], \"start\": 0, \"duration\": 4, \"velocity\": 80}}], \"vocal\": [{{\"note\": \"G4\", \"start\": 0, \"duration\": 1, \"velocity\": 75}}], \"string\": [{{\"notes\": [\"C4\", \"G4\"], \"start\": 0, \"duration\": 8, \"velocity\": 70}}] }} }}.\nUse beats for start and duration. Use standard note names like C4, D#4, Bb3.",
        bars = request.bars,
        bpm = request.bpm,
        key = request.key,
        scale = request.scale,
        prompt = request.prompt,
    );

    let client = reqwest::Client::new();
    let response = client
        .post(OPENAI_API_URL)
        .header(AUTHORIZATION, format!("Bearer {}", request.api_key.trim()))
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": MODEL,
            "instructions": SYSTEM_PROMPT,
            "input": input,
            "text": OpenAiTextConfig {
                format: OpenAiTextFormat { kind: "json_object" }
            }
        }))
        .send()
        .await
        .map_err(|_| "Unable to contact OpenAI API.".to_string())?;

    let status = response.status();
    let payload: OpenAiResponse = response
        .json()
        .await
        .map_err(|_| "OpenAI returned an unreadable response.".to_string())?;

    if !status.is_success() {
        let message = payload
            .error
            .map(|error| error.message)
            .unwrap_or_else(|| "OpenAI request failed.".to_string());
        return Err(message);
    }

    let raw_json = payload
        .output_text
        .or_else(|| {
            payload.output.and_then(|items| {
                items.into_iter().find_map(|item| {
                    item.content.and_then(|content_items| {
                        content_items.into_iter().find_map(|content_item| {
                            if content_item.kind == "output_text" {
                                content_item.text
                            } else {
                                None
                            }
                        })
                    })
                })
            })
        })
        .ok_or_else(|| "OpenAI did not return JSON output.".to_string())?;

    serde_json::from_str::<Value>(&raw_json)
        .map_err(|_| "OpenAI returned invalid JSON. Adjust the prompt and retry.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![generate_music_structure])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
