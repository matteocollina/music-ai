use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

const OPENAI_API_URL: &str = "https://api.openai.com/v1/responses";
const MODEL: &str = "gpt-5.4";

const HARMONY_SYSTEM_PROMPT: &str = r#"
You are an expressive melodic techno harmony engine.
Return valid JSON only. No markdown, no explanations.

Your job is ONLY to create one coherent chord progression.
The progression must define the full harmonic structure for the loop.

Rules:
- Keep everything inside the requested key and scale.
- Prefer emotional melodic techno progressions.
- Use smooth voice leading.
- Use one chord per bar unless explicitly requested otherwise.
- The final bar must lead naturally back to bar 1.
- Create a fresh progression identity for each variation request.
- Avoid random chromatic chords.
- Use emotional chord colors only if compatible with the key: minor7, maj7, add9, sus2, sus4.
"#;

const TRACK_SYSTEM_PROMPT: &str = r#"
You are an expressive MIDI track generator.
Return valid JSON only. No markdown, no explanations.

You will receive a fixed chord progression.
You must generate ONLY the requested track.

Critical rules:
- Do not invent a new progression.
- Every note must follow the active chord at its start time.
- Prefer chord tones: root, third, fifth, seventh.
- Non-chord tones are allowed only as short passing tones that resolve stepwise.
- Avoid clashes with the active chord.
- Avoid random note streams.
- Give each take a distinct contour, phrasing, and emotional arc.
- Use repetition, motif development, and tasteful variations.
- Use beats for start and duration.
"#;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateMusicRequest {
    api_key: String,
    bpm: u16,
    key: String,
    scale: String,
    bars: u16,
    creativity: f32,
    prompt: String,
    variation_token: String,
    reference_analysis: Option<ReferenceAnalysisInput>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceAnalysisInput {
    chord_timeline: Vec<ReferenceChordTimelineEntry>,
}

#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ReferenceChordTimelineEntry {
    chord: String,
    start_time: f32,
    end_time: f32,
    confidence: f32,
    notes: Vec<String>,
    bar: u16,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ProgressionChord {
    bar: u16,
    symbol: String,
    notes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SingleNote {
    note: String,
    start: f32,
    duration: f32,
    velocity: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MultiNote {
    notes: Vec<String>,
    start: f32,
    duration: f32,
    velocity: u8,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ProgressionResponse {
    progression: Vec<ProgressionChord>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct SingleNoteTrackResponse {
    notes: Vec<SingleNote>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MultiNoteTrackResponse {
    notes: Vec<MultiNote>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct Tracks {
    arpeggiator: Vec<SingleNote>,
    chords: Vec<MultiNote>,
    vocal: Vec<SingleNote>,
    string: Vec<MultiNote>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct MusicStructure {
    bpm: u16,
    key: String,
    scale: String,
    progression: Vec<ProgressionChord>,
    tracks: Tracks,
}

fn creativity_sampling(creativity: f32) -> (f32, f32) {
    let normalized = (creativity / 100.0).clamp(0.0, 1.0);
    let temperature = 0.35 + (normalized * 0.55);
    let top_p = 0.72 + (normalized * 0.23);
    (temperature, top_p)
}

fn hashed_index(seed: &str, salt: &str, len: usize) -> usize {
    let mut hash: u64 = 1469598103934665603;

    for byte in seed.bytes().chain(salt.bytes()) {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(1099511628211);
    }

    (hash as usize) % len.max(1)
}

fn build_reference_context(request: &GenerateMusicRequest, progression: &[ProgressionChord]) -> String {
    if request.reference_analysis.is_none() {
        return "No reference audio was provided. Shape the track from the prompt and chord progression only.".to_string();
    }

    let chord_symbols = progression
        .iter()
        .map(|chord| format!("bar {}: {}", chord.bar, chord.symbol))
        .collect::<Vec<_>>()
        .join(", ");

    format!(
        "Reference audio mode is active. Reflect the harmonic tension and release implied by this extracted chord path: {}. \
         Do not clone a stock arp; let bar-to-bar density and contour react to the chord changes.",
        chord_symbols
    )
}

fn build_arpeggiator_rules(request: &GenerateMusicRequest, progression: &[ProgressionChord]) -> String {
    const RHYTHMIC_PROFILES: &[&str] = &[
        "Use a syncopated gate pattern with off-beat accents and occasional 1/16 flurries.",
        "Use a rolling 1/16 pulse with strategic rests every 1 or 2 bars.",
        "Use a broken 1/8 pattern with occasional doubled pickups before chord changes.",
        "Use a staggered pattern that alternates sparse bars and denser answer bars.",
        "Use a driving pulse with repeating accents every 3 notes instead of every beat.",
    ];
    const CONTOUR_PROFILES: &[&str] = &[
        "Contour should climb through the bar, then reset with a lower pickup.",
        "Contour should bounce between inner chord tones and top extensions.",
        "Contour should alternate upward sweeps and downward answers across adjacent bars.",
        "Contour should emphasize wide registral contrast between phrase starts and endings.",
        "Contour should orbit around one anchor tone, then break away at transitions.",
    ];
    const TIMBRE_GESTURES: &[&str] = &[
        "Favor tight mid-register notes around C4-C5.",
        "Use mid-high register energy and occasional octave displacement.",
        "Lean darker with lower-register starts, then open upward at phrase peaks.",
        "Start compact, then expand the register in later bars.",
        "Alternate close voicings and octave spread gestures.",
    ];
    const VARIATION_MOVES: &[&str] = &[
        "At least every 2 bars, mutate the motif rhythm or starting chord tone.",
        "When the harmony changes, answer with a clearly different inversion focus.",
        "Use one recurring motif, but reshape its ending in each repetition.",
        "Do not reuse the exact same note order in consecutive bars unless the chord is unchanged and you add accent changes.",
        "Create a phrase-level evolution from bars 1-4 and a distinct response in later bars.",
    ];

    let variation_seed = &request.variation_token;
    let prompt_context = if request.prompt.trim().is_empty() {
        "No free-text style prompt is active.".to_string()
    } else {
        format!("Style prompt to translate into arp behavior: {}.", request.prompt.trim())
    };

    format!(
        r#"
- Hypnotic melodic techno arpeggiator with a clearly identifiable motif.
- Every note must fit the active chord at its start time, but passing tones from the scale are allowed when they resolve immediately.
- Use a mix of 1/8, 1/16, dotted values, ties, and rests; avoid a flat machine-gun stream.
- Do not create independent harmony.
- Avoid too many octave jumps in a row, but allow occasional register leaps for contrast.
- Build phrase evolution, not just a single bar loop copied forever.
- {}
- {}
- {}
- {}
- {}
- {}
"#,
        RHYTHMIC_PROFILES[hashed_index(variation_seed, "rhythm", RHYTHMIC_PROFILES.len())],
        CONTOUR_PROFILES[hashed_index(variation_seed, "contour", CONTOUR_PROFILES.len())],
        TIMBRE_GESTURES[hashed_index(variation_seed, "register", TIMBRE_GESTURES.len())],
        VARIATION_MOVES[hashed_index(variation_seed, "variation", VARIATION_MOVES.len())],
        prompt_context,
        build_reference_context(request, progression),
    )
}

async fn call_openai_json(
    client: &reqwest::Client,
    api_key: &str,
    instructions: &str,
    input: &str,
    temperature: f32,
    top_p: f32,
) -> Result<String, String> {
    let response = client
        .post(OPENAI_API_URL)
        .header(AUTHORIZATION, format!("Bearer {}", api_key.trim()))
        .header(CONTENT_TYPE, "application/json")
        .json(&json!({
            "model": MODEL,
            "instructions": instructions,
            "input": input,
            "temperature": temperature,
            "top_p": top_p,
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

    payload
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
        .ok_or_else(|| "OpenAI did not return JSON output.".to_string())
}

async fn generate_progression(
    client: &reqwest::Client,
    api_key: &str,
    request: &GenerateMusicRequest,
) -> Result<Vec<ProgressionChord>, String> {
    if let Some(reference) = &request.reference_analysis {
        let progression = reference_progression(reference)?;

        if !progression.is_empty() {
            return Ok(progression);
        }
    }

    let input = format!(
        r#"
Create ONLY the chord progression for a loopable melodic techno composition.

BPM: {bpm}
Key: {key}
Scale: {scale}
Bars: {bars}
Creative intensity: {creativity}/100
Variation token: {variation_token}
Style prompt: {prompt}

Style target:
- Emotional melodic techno
- Anyma / Tale Of Us / Afterlife-inspired atmosphere
- Dark, cinematic, melancholic, futuristic
- Touching harmonic movement
- Make this take feel like a fresh interpretation, not the safest default.

Progression rules:
- One chord per bar.
- progression length must equal {bars}.
- Each chord must include exact MIDI note names.
- Use notes around C3-C5.
- Use smooth voice leading.
- Final chord must resolve naturally into the first chord.
- Use the variation token to explore a different but still musically coherent harmonic path.

Return JSON only:
{{
  "progression": [
    {{
      "bar": 1,
      "symbol": "F#m7",
      "notes": ["F#3", "A3", "C#4", "E4"]
    }}
  ]
}}
"#,
        bpm = request.bpm,
        key = request.key,
        scale = request.scale,
        bars = request.bars,
        creativity = request.creativity.round(),
        variation_token = request.variation_token,
        prompt = request.prompt,
    );

    let (temperature, top_p) = creativity_sampling(request.creativity);
    let raw = call_openai_json(client, api_key, HARMONY_SYSTEM_PROMPT, &input, temperature, top_p).await?;
    let parsed: ProgressionResponse =
        serde_json::from_str(&raw).map_err(|_| "OpenAI returned invalid progression JSON.".to_string())?;

    if parsed.progression.is_empty() {
        return Err("OpenAI returned an empty progression.".to_string());
    }

    Ok(parsed.progression)
}

fn reference_progression(reference: &ReferenceAnalysisInput) -> Result<Vec<ProgressionChord>, String> {
    let mut progression = Vec::new();

    for (index, segment) in reference.chord_timeline.iter().enumerate() {
        if segment.notes.is_empty() {
            continue;
        }

        let inferred_bar = if segment.bar == 0 { index as u16 + 1 } else { segment.bar };
        let bar = inferred_bar.max(1);

        let _duration = (segment.end_time - segment.start_time).max(0.0);
        let _confidence = segment.confidence;

        progression.push(ProgressionChord {
            bar,
            symbol: segment.chord.clone(),
            notes: segment.notes.clone(),
        });
    }

    progression.sort_by_key(|entry| entry.bar);
    progression.dedup_by(|current, previous| current.bar == previous.bar);

    if progression.is_empty() {
        return Err("Reference song analysis did not produce a usable chord progression.".to_string());
    }

    Ok(progression)
}

async fn generate_single_note_track(
    client: &reqwest::Client,
    api_key: &str,
    request: &GenerateMusicRequest,
    progression: &[ProgressionChord],
    track_name: &str,
    track_rules: &str,
) -> Result<Vec<SingleNote>, String> {
    let input = format!(
        r#"
Generate ONLY the "{track_name}" MIDI track.

BPM: {bpm}
Key: {key}
Scale: {scale}
Bars: {bars}
Creative intensity: {creativity}/100
Variation token: {variation_token}
Style prompt: {prompt}

Fixed chord progression:
{progression_json}

Track-specific rules:
{track_rules}

Creative direction:
- Keep the harmony valid, but avoid the most obvious phrasing.
- Let the variation token push this take toward a distinct motif and gesture.

Return JSON only:
{{
  "notes": [
    {{
      "note": "C4",
      "start": 0,
      "duration": 0.5,
      "velocity": 90
    }}
  ]
}}
"#,
        track_name = track_name,
        bpm = request.bpm,
        key = request.key,
        scale = request.scale,
        bars = request.bars,
        creativity = request.creativity.round(),
        variation_token = request.variation_token,
        prompt = request.prompt,
        progression_json = serde_json::to_string_pretty(progression).unwrap_or_default(),
        track_rules = track_rules,
    );

    let (temperature, top_p) = creativity_sampling(request.creativity);
    let raw = call_openai_json(client, api_key, TRACK_SYSTEM_PROMPT, &input, temperature, top_p).await?;
    let parsed: SingleNoteTrackResponse =
        serde_json::from_str(&raw).map_err(|_| format!("OpenAI returned invalid {track_name} JSON."))?;

    Ok(parsed.notes)
}

async fn generate_multi_note_track(
    client: &reqwest::Client,
    api_key: &str,
    request: &GenerateMusicRequest,
    progression: &[ProgressionChord],
    track_name: &str,
    track_rules: &str,
) -> Result<Vec<MultiNote>, String> {
    let input = format!(
        r#"
Generate ONLY the "{track_name}" MIDI track.

BPM: {bpm}
Key: {key}
Scale: {scale}
Bars: {bars}
Creative intensity: {creativity}/100
Variation token: {variation_token}
Style prompt: {prompt}

Fixed chord progression:
{progression_json}

Track-specific rules:
{track_rules}

Creative direction:
- Keep the harmony valid, but avoid the most obvious voicing and rhythm every time.
- Let the variation token push this take toward a distinct motif and gesture.

Return JSON only:
{{
  "notes": [
    {{
      "notes": ["C3", "E3", "G3"],
      "start": 0,
      "duration": 4,
      "velocity": 80
    }}
  ]
}}
"#,
        track_name = track_name,
        bpm = request.bpm,
        key = request.key,
        scale = request.scale,
        bars = request.bars,
        creativity = request.creativity.round(),
        variation_token = request.variation_token,
        prompt = request.prompt,
        progression_json = serde_json::to_string_pretty(progression).unwrap_or_default(),
        track_rules = track_rules,
    );

    let (temperature, top_p) = creativity_sampling(request.creativity);
    let raw = call_openai_json(client, api_key, TRACK_SYSTEM_PROMPT, &input, temperature, top_p).await?;
    let parsed: MultiNoteTrackResponse =
        serde_json::from_str(&raw).map_err(|_| format!("OpenAI returned invalid {track_name} JSON."))?;

    Ok(parsed.notes)
}

fn pitch_class(note: &str) -> Option<String> {
    let mut chars = note.chars().peekable();
    let first = chars.next()?;

    if !matches!(first, 'A'..='G') {
        return None;
    }

    let mut pc = first.to_string();

    if let Some(next) = chars.peek() {
        if *next == '#' || *next == 'b' {
            pc.push(*next);
        }
    }

    Some(normalize_pitch_class(&pc))
}

fn normalize_pitch_class(pc: &str) -> String {
    match pc {
        "B#" => "C",
        "Cb" => "B",
        "E#" => "F",
        "Fb" => "E",
        "C#" | "Db" => "C#",
        "D#" | "Eb" => "D#",
        "F#" | "Gb" => "F#",
        "G#" | "Ab" => "G#",
        "A#" | "Bb" => "A#",
        other => other,
    }
    .to_string()
}

fn note_octave(note: &str) -> Option<i32> {
    let digits: String = note
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '-')
        .collect();

    digits.parse::<i32>().ok()
}

fn note_to_midi(note: &str) -> Option<i32> {
    let pc = pitch_class(note)?;
    let octave = note_octave(note)?;

    let pc_num = match pc.as_str() {
        "C" => 0,
        "C#" => 1,
        "D" => 2,
        "D#" => 3,
        "E" => 4,
        "F" => 5,
        "F#" => 6,
        "G" => 7,
        "G#" => 8,
        "A" => 9,
        "A#" => 10,
        "B" => 11,
        _ => return None,
    };

    Some((octave + 1) * 12 + pc_num)
}

fn midi_to_note(midi: i32) -> String {
    let names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    let pc = midi.rem_euclid(12) as usize;
    let octave = midi.div_euclid(12) - 1;
    format!("{}{}", names[pc], octave)
}

fn scale_pitch_classes(key: &str, scale: &str) -> HashSet<String> {
    let root_pc = pitch_class(&format!("{}4", key)).unwrap_or_else(|| normalize_pitch_class(key));
    let root_num = match root_pc.as_str() {
        "C" => 0,
        "C#" => 1,
        "D" => 2,
        "D#" => 3,
        "E" => 4,
        "F" => 5,
        "F#" => 6,
        "G" => 7,
        "G#" => 8,
        "A" => 9,
        "A#" => 10,
        "B" => 11,
        _ => 0,
    };

    let intervals: Vec<i32> = match scale.to_lowercase().as_str() {
        "minor" | "natural minor" | "aeolian" => vec![0, 2, 3, 5, 7, 8, 10],
        "harmonic minor" => vec![0, 2, 3, 5, 7, 8, 11],
        "melodic minor" => vec![0, 2, 3, 5, 7, 9, 11],
        "major" | "ionian" => vec![0, 2, 4, 5, 7, 9, 11],
        "dorian" => vec![0, 2, 3, 5, 7, 9, 10],
        "phrygian" => vec![0, 1, 3, 5, 7, 8, 10],
        _ => vec![0, 2, 3, 5, 7, 8, 10],
    };

    intervals
        .into_iter()
        .map(|i| midi_to_note(60 + (root_num + i).rem_euclid(12)))
        .filter_map(|n| pitch_class(&n))
        .collect()
}

fn active_chord_for_start(start: f32, progression: &[ProgressionChord]) -> Option<&ProgressionChord> {
    if progression.is_empty() {
        return None;
    }

    let bar = (start / 4.0).floor() as u16 + 1;

    progression
        .iter()
        .find(|chord| chord.bar == bar)
        .or_else(|| progression.last())
}

fn nearest_allowed_note(original: &str, allowed_notes: &[String]) -> String {
    let original_midi = note_to_midi(original).unwrap_or(60);

    let mut candidates: Vec<String> = Vec::new();

    for allowed in allowed_notes {
        if let Some(pc) = pitch_class(allowed) {
            for octave in 1..=7 {
                candidates.push(format!("{}{}", pc, octave));
            }
        }
    }

    candidates
        .into_iter()
        .filter_map(|candidate| {
            note_to_midi(&candidate).map(|midi| {
                let distance = (midi - original_midi).abs();
                (candidate, distance)
            })
        })
        .min_by_key(|(_, distance)| *distance)
        .map(|(candidate, _)| candidate)
        .unwrap_or_else(|| original.to_string())
}

fn sanitize_single_note(
    note: &mut SingleNote,
    progression: &[ProgressionChord],
    scale_pcs: &HashSet<String>,
    allow_scale_tones_outside_chord: bool,
) {
    if let Some(active_chord) = active_chord_for_start(note.start, progression) {
        let chord_pcs: HashSet<String> = active_chord
            .notes
            .iter()
            .filter_map(|n| pitch_class(n))
            .collect();

        let note_pc = pitch_class(&note.note);

        let is_chord_tone = note_pc
            .as_ref()
            .map(|pc| chord_pcs.contains(pc))
            .unwrap_or(false);

        let is_scale_tone = note_pc
            .as_ref()
            .map(|pc| scale_pcs.contains(pc))
            .unwrap_or(false);

        let keep_note = if allow_scale_tones_outside_chord {
            is_scale_tone
        } else {
            is_chord_tone && is_scale_tone
        };

        if !keep_note {
            note.note = nearest_allowed_note(&note.note, &active_chord.notes);
        }
    }

    note.duration = note.duration.max(0.125);
    note.velocity = note.velocity.clamp(1, 127);
}

fn sanitize_multi_note(chord: &mut MultiNote, progression: &[ProgressionChord], scale_pcs: &HashSet<String>) {
    if let Some(active_chord) = active_chord_for_start(chord.start, progression) {
        let chord_pcs: HashSet<String> = active_chord
            .notes
            .iter()
            .filter_map(|n| pitch_class(n))
            .collect();

        chord.notes = chord
            .notes
            .iter()
            .map(|note| {
                let note_pc = pitch_class(note);

                let is_chord_tone = note_pc
                    .as_ref()
                    .map(|pc| chord_pcs.contains(pc))
                    .unwrap_or(false);

                let is_scale_tone = note_pc
                    .as_ref()
                    .map(|pc| scale_pcs.contains(pc))
                    .unwrap_or(false);

                if !is_chord_tone || !is_scale_tone {
                    nearest_allowed_note(note, &active_chord.notes)
                } else {
                    note.clone()
                }
            })
            .collect();
    }

    chord.duration = chord.duration.max(0.125);
    chord.velocity = chord.velocity.clamp(1, 127);
}

fn sanitize_music_structure(structure: &mut MusicStructure) {
    let scale_pcs = scale_pitch_classes(&structure.key, &structure.scale);
    let total_beats = structure.bars_total_beats();

    structure.progression.sort_by_key(|chord| chord.bar);

    for note in &mut structure.tracks.arpeggiator {
        note.start = note.start.clamp(0.0, total_beats);
        sanitize_single_note(note, &structure.progression, &scale_pcs, true);
    }

    for note in &mut structure.tracks.vocal {
        note.start = note.start.clamp(0.0, total_beats);
        sanitize_single_note(note, &structure.progression, &scale_pcs, false);
    }

    for chord in &mut structure.tracks.chords {
        chord.start = chord.start.clamp(0.0, total_beats);
        sanitize_multi_note(chord, &structure.progression, &scale_pcs);
    }

    for chord in &mut structure.tracks.string {
        chord.start = chord.start.clamp(0.0, total_beats);
        sanitize_multi_note(chord, &structure.progression, &scale_pcs);
    }
}

impl MusicStructure {
    fn bars_total_beats(&self) -> f32 {
        let last_bar = self
            .progression
            .iter()
            .map(|chord| chord.bar)
            .max()
            .unwrap_or(1);

        last_bar as f32 * 4.0
    }
}

#[tauri::command]
async fn generate_music_structure(request: GenerateMusicRequest) -> Result<Value, String> {
    if request.api_key.trim().is_empty() {
        return Err("Missing OpenAI API Key.".into());
    }

    if request.bars == 0 {
        return Err("Bars must be greater than zero.".into());
    }

    if !(0.0..=100.0).contains(&request.creativity) {
        return Err("Creativity must be between 0 and 100.".into());
    }

    let client = reqwest::Client::new();
    let api_key = request.api_key.trim();

    let progression = generate_progression(&client, api_key, &request).await?;
    let arpeggiator_rules = build_arpeggiator_rules(&request, &progression);

    let arpeggiator = generate_single_note_track(
        &client,
        api_key,
        &request,
        &progression,
        "arpeggiator",
        &arpeggiator_rules,
    )
    .await?;

    let chords = generate_multi_note_track(
        &client,
        api_key,
        &request,
        &progression,
        "chords",
        r#"
- Warm analog synth chord foundation.
- Use the exact active chord notes or smooth inversions of them.
- Prefer one long chord per bar.
- Do not add chromatic notes.
- Use C3-C5 range.
"#,
    )
    .await?;

    let vocal = generate_single_note_track(
        &client,
        api_key,
        &request,
        &progression,
        "vocal",
        r#"
- Sparse emotional vocal-like lead.
- Memorable Anyma-style motif.
- Mostly chord tones.
- Use rests.
- Maximum 3 notes per bar.
- Avoid fast runs.
- Avoid notes that imply another chord.
"#,
    )
    .await?;

    let string = generate_multi_note_track(
        &client,
        api_key,
        &request,
        &progression,
        "string",
        r#"
- Sustained cinematic string/pad support.
- Long notes only.
- Use root, fifth, third, or seventh from the active chord.
- No independent melody.
- Prefer 1 or 2 notes at a time.
- Reinforce the emotional harmony.
"#,
    )
    .await?;

    let mut structure = MusicStructure {
        bpm: request.bpm,
        key: request.key.clone(),
        scale: request.scale.clone(),
        progression,
        tracks: Tracks {
            arpeggiator,
            chords,
            vocal,
            string,
        },
    };

    sanitize_music_structure(&mut structure);

    serde_json::to_value(structure)
        .map_err(|_| "Unable to serialize final music structure.".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![generate_music_structure])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
