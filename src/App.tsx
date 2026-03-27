import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type ScaleMode = "major" | "minor";

type KeyOption = {
  id: string;
  label: string;
  mode: ScaleMode;
  rootPitchClass: number;
  signature: {
    mi: 0 | 1;
    sf: number;
  };
};

type PlannedNote = {
  degree: number;
  durationBeats: number;
  octave: number;
  startBeat: number;
  velocity: number;
};

type MidiPlan = {
  notes: PlannedNote[];
  title: string;
};

type GeneratedMidi = {
  fileName: string;
  noteCount: number;
  title: string;
  url: string;
};

type ChatCompletionEnvelope = {
  choices?: Array<{
    message?: {
      content?: string | null;
      refusal?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

const BPM_OPTIONS = [90, 100, 110, 120, 124, 128, 132, 140];
const BAR_OPTIONS = [4, 8, 16, 32];
const SCALE_INTERVALS: Record<ScaleMode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};
const TICKS_PER_BEAT = 480;
const STORAGE_KEY = "music-ai:openai-api-key";

const KEY_OPTIONS: KeyOption[] = [
  { id: "C-major", label: "C Major", mode: "major", rootPitchClass: 0, signature: { mi: 0, sf: 0 } },
  { id: "G-major", label: "G Major", mode: "major", rootPitchClass: 7, signature: { mi: 0, sf: 1 } },
  { id: "D-major", label: "D Major", mode: "major", rootPitchClass: 2, signature: { mi: 0, sf: 2 } },
  { id: "A-major", label: "A Major", mode: "major", rootPitchClass: 9, signature: { mi: 0, sf: 3 } },
  { id: "E-major", label: "E Major", mode: "major", rootPitchClass: 4, signature: { mi: 0, sf: 4 } },
  { id: "F-major", label: "F Major", mode: "major", rootPitchClass: 5, signature: { mi: 0, sf: -1 } },
  { id: "Bb-major", label: "Bb Major", mode: "major", rootPitchClass: 10, signature: { mi: 0, sf: -2 } },
  { id: "Eb-major", label: "Eb Major", mode: "major", rootPitchClass: 3, signature: { mi: 0, sf: -3 } },
  { id: "A-minor", label: "A Minor", mode: "minor", rootPitchClass: 9, signature: { mi: 1, sf: 0 } },
  { id: "E-minor", label: "E Minor", mode: "minor", rootPitchClass: 4, signature: { mi: 1, sf: 1 } },
  { id: "B-minor", label: "B Minor", mode: "minor", rootPitchClass: 11, signature: { mi: 1, sf: 2 } },
  { id: "Fsharp-minor", label: "F# Minor", mode: "minor", rootPitchClass: 6, signature: { mi: 1, sf: 3 } },
  { id: "Csharp-minor", label: "C# Minor", mode: "minor", rootPitchClass: 1, signature: { mi: 1, sf: 4 } },
  { id: "D-minor", label: "D Minor", mode: "minor", rootPitchClass: 2, signature: { mi: 1, sf: -1 } },
  { id: "G-minor", label: "G Minor", mode: "minor", rootPitchClass: 7, signature: { mi: 1, sf: -2 } },
  { id: "C-minor", label: "C Minor", mode: "minor", rootPitchClass: 0, signature: { mi: 1, sf: -3 } },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function encodeVariableLength(value: number) {
  let buffer = value & 0x7f;
  const bytes = [];

  while ((value >>= 7) > 0) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }

  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) {
      buffer >>= 8;
    } else {
      break;
    }
  }

  return bytes;
}

function u16(value: number) {
  return [(value >> 8) & 0xff, value & 0xff];
}

function u32(value: number) {
  return [(value >> 24) & 0xff, (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
}

function textMeta(metaType: number, text: string) {
  const bytes = Array.from(new TextEncoder().encode(text));
  return [0xff, metaType, ...encodeVariableLength(bytes.length), ...bytes];
}

function tempoMeta(bpm: number) {
  const microsecondsPerBeat = Math.round(60_000_000 / bpm);
  return [0xff, 0x51, 0x03, (microsecondsPerBeat >> 16) & 0xff, (microsecondsPerBeat >> 8) & 0xff, microsecondsPerBeat & 0xff];
}

function timeSignatureMeta() {
  return [0xff, 0x58, 0x04, 4, 2, 24, 8];
}

function keySignatureMeta(key: KeyOption) {
  return [0xff, 0x59, 0x02, key.signature.sf & 0xff, key.signature.mi];
}

function degreeToMidi(note: PlannedNote, key: KeyOption) {
  const scale = SCALE_INTERVALS[key.mode];
  const degreeIndex = clamp(Math.round(note.degree), 1, 7) - 1;
  const octave = clamp(Math.round(note.octave), 3, 6);
  return clamp((octave + 1) * 12 + key.rootPitchClass + scale[degreeIndex], 36, 96);
}

function normalizePlan(rawPlan: MidiPlan, key: KeyOption, bars: number): MidiPlan {
  const totalBeats = bars * 4;
  const notes = rawPlan.notes
    .map((note) => {
      const startBeat = clamp(Number(note.startBeat) || 0, 0, Math.max(0, totalBeats - 0.25));
      const durationBeats = clamp(Number(note.durationBeats) || 0.5, 0.25, 4);
      const safeDuration = Math.min(durationBeats, totalBeats - startBeat);

      return {
        degree: clamp(Math.round(note.degree) || 1, 1, 7),
        durationBeats: safeDuration || 0.25,
        octave: clamp(Math.round(note.octave) || 4, 3, 6),
        startBeat,
        velocity: clamp(Math.round(note.velocity) || 88, 48, 120),
      };
    })
    .filter((note) => note.durationBeats > 0)
    .sort((left, right) => left.startBeat - right.startBeat);

  if (!notes.length) {
    throw new Error("OpenAI returned an empty melody.");
  }

  return {
    notes,
    title: rawPlan.title?.trim() || `${key.label} piano sketch`,
  };
}

function buildMidiBytes(plan: MidiPlan, bpm: number, key: KeyOption) {
  const events: Array<{ bytes: number[]; priority: number; tick: number }> = [
    { bytes: textMeta(0x03, plan.title), priority: 0, tick: 0 },
    { bytes: tempoMeta(bpm), priority: 0, tick: 0 },
    { bytes: timeSignatureMeta(), priority: 0, tick: 0 },
    { bytes: keySignatureMeta(key), priority: 0, tick: 0 },
    { bytes: [0xc0, 0x00], priority: 1, tick: 0 },
  ];

  for (const note of plan.notes) {
    const midi = degreeToMidi(note, key);
    const startTick = Math.round(note.startBeat * TICKS_PER_BEAT);
    const endTick = startTick + Math.max(1, Math.round(note.durationBeats * TICKS_PER_BEAT));

    events.push({ bytes: [0x90, midi, note.velocity], priority: 3, tick: startTick });
    events.push({ bytes: [0x80, midi, 0], priority: 2, tick: endTick });
  }

  events.sort((left, right) => left.tick - right.tick || left.priority - right.priority || left.bytes[1] - right.bytes[1]);

  let previousTick = 0;
  const trackBytes: number[] = [];

  for (const event of events) {
    const delta = event.tick - previousTick;
    trackBytes.push(...encodeVariableLength(delta), ...event.bytes);
    previousTick = event.tick;
  }

  trackBytes.push(0x00, 0xff, 0x2f, 0x00);

  return new Uint8Array([
    0x4d,
    0x54,
    0x68,
    0x64,
    ...u32(6),
    ...u16(0),
    ...u16(1),
    ...u16(TICKS_PER_BEAT),
    0x4d,
    0x54,
    0x72,
    0x6b,
    ...u32(trackBytes.length),
    ...trackBytes,
  ]);
}

function isMidiPlan(value: unknown): value is MidiPlan {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { notes?: unknown; title?: unknown };
  return typeof candidate.title === "string" && Array.isArray(candidate.notes);
}

async function requestMidiPlan(apiKey: string, sentiment: string, bpm: number, bars: number, key: KeyOption) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    body: JSON.stringify({
      messages: [
        {
          content: [
            "You are a MIDI composition planner for a desktop music app.",
            "Return only valid JSON for a single-track piano performance.",
            "The melody must fit 4/4, stay inside the selected key, and feel loopable.",
            "Use scale degrees 1-7 relative to the requested key instead of raw MIDI pitches.",
            "Prefer musical phrasing, repetition, and small variations over random notes.",
            "Keep the arrangement dense enough to feel intentional, but avoid chaos.",
            'JSON shape: {"title":"string","notes":[{"startBeat":number,"durationBeats":number,"degree":integer 1-7,"octave":integer 3-6,"velocity":integer 48-120}]}',
          ].join(" "),
          role: "system" as const,
        },
        {
          content: [
            `Sentiment: ${sentiment}`,
            `Tempo: ${bpm} BPM`,
            `Bars: ${bars}`,
            `Key: ${key.label}`,
            `Scale mode: ${key.mode}`,
            "Generate a memorable piano idea with emotional contour matching the sentiment.",
            "Notes must stay within octaves 3 to 6 and velocities 48 to 120.",
            "Use startBeat values within the full loop length and durationBeats from 0.25 to 4.",
            "Respond with JSON only. No markdown, no explanation, no code fences.",
          ].join("\n"),
          role: "user" as const,
        },
      ],
      max_completion_tokens: 1800,
      model: "gpt-4o-mini",
      response_format: {
        type: "json_object",
      },
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = (await response.json()) as ChatCompletionEnvelope;
  if (!response.ok) {
    throw new Error(payload.error?.message || "OpenAI request failed.");
  }

  const choice = payload.choices?.[0]?.message;
  if (choice?.refusal?.trim()) {
    throw new Error(choice.refusal);
  }

  if (choice?.content?.trim()) {
    const parsed = JSON.parse(choice.content);
    if (isMidiPlan(parsed)) {
      return parsed;
    }
  }

  throw new Error("OpenAI did not return a valid MIDI JSON payload.");
}

async function previewMidiPlan(plan: MidiPlan, bpm: number, key: KeyOption) {
  const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("Audio preview is not supported in this browser.");
  }

  const context = new AudioContextCtor();
  const noteEvents = plan.notes.map((note) => ({
    durationSeconds: note.durationBeats * (60 / bpm),
    frequency: 440 * 2 ** ((degreeToMidi(note, key) - 69) / 12),
    startSeconds: note.startBeat * (60 / bpm),
    velocity: note.velocity / 127,
  }));

  const master = context.createGain();
  master.gain.value = 0.18;
  master.connect(context.destination);

  const now = context.currentTime + 0.04;
  const releaseTail = 1.2;
  const totalDuration = noteEvents.reduce((max, note) => Math.max(max, note.startSeconds + note.durationSeconds), 0);

  for (const note of noteEvents) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();

    oscillator.type = "triangle";
    oscillator.frequency.value = note.frequency;
    gain.gain.setValueAtTime(0, now + note.startSeconds);
    gain.gain.linearRampToValueAtTime(note.velocity * 0.42, now + note.startSeconds + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note.startSeconds + note.durationSeconds + 0.6);

    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(now + note.startSeconds);
    oscillator.stop(now + note.startSeconds + note.durationSeconds + releaseTail);
  }

  window.setTimeout(() => {
    void context.close();
  }, Math.ceil((totalDuration + releaseTail + 0.25) * 1000));
}

function App() {
  const [apiKeyDraft, setApiKeyDraft] = useState(() => window.localStorage.getItem(STORAGE_KEY) ?? "");
  const [savedApiKey, setSavedApiKey] = useState(() => window.localStorage.getItem(STORAGE_KEY) ?? "");
  const [sentiment, setSentiment] = useState("Dark but hopeful melodic techno, cinematic and hypnotic.");
  const [bpm, setBpm] = useState(124);
  const [bars, setBars] = useState(8);
  const [keyId, setKeyId] = useState("D-minor");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("Ready to generate a piano MIDI sketch.");
  const [generatedMidi, setGeneratedMidi] = useState<GeneratedMidi | null>(null);
  const latestPlanRef = useRef<MidiPlan | null>(null);

  const selectedKey = useMemo(
    () => KEY_OPTIONS.find((option) => option.id === keyId) ?? KEY_OPTIONS.find((option) => option.id === "D-minor")!,
    [keyId],
  );

  useEffect(() => {
    return () => {
      if (generatedMidi?.url) {
        URL.revokeObjectURL(generatedMidi.url);
      }
    };
  }, [generatedMidi]);

  function saveApiKey() {
    const trimmed = apiKeyDraft.trim();
    if (!trimmed) {
      setError("Enter your OpenAI API key before saving it.");
      return;
    }

    window.localStorage.setItem(STORAGE_KEY, trimmed);
    setSavedApiKey(trimmed);
    setError("");
    setStatus("OpenAI API key saved locally in this app.");
  }

  function clearApiKey() {
    window.localStorage.removeItem(STORAGE_KEY);
    setApiKeyDraft("");
    setSavedApiKey("");
    setStatus("Saved OpenAI API key removed.");
  }

  async function generateMidi() {
    if (!savedApiKey.trim()) {
      setError("Save your OpenAI API key first.");
      return;
    }

    if (!sentiment.trim()) {
      setError("Describe the sentiment before generating.");
      return;
    }

    setIsGenerating(true);
    setError("");
    setStatus("Generating melody plan with OpenAI...");

    try {
      const rawPlan = await requestMidiPlan(savedApiKey, sentiment.trim(), bpm, bars, selectedKey);
      const normalizedPlan = normalizePlan(rawPlan, selectedKey, bars);
      const bytes = buildMidiBytes(normalizedPlan, bpm, selectedKey);
      const blob = new Blob([bytes], { type: "audio/midi" });
      const url = URL.createObjectURL(blob);
      const safeName = normalizedPlan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
      const fileName = `${safeName || "generated-midi"}.mid`;

      setGeneratedMidi((current) => {
        if (current?.url) {
          URL.revokeObjectURL(current.url);
        }

        return {
          fileName,
          noteCount: normalizedPlan.notes.length,
          title: normalizedPlan.title,
          url,
        };
      });
      latestPlanRef.current = normalizedPlan;

      setStatus(`Generated ${normalizedPlan.notes.length} piano notes in ${selectedKey.label} at ${bpm} BPM.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Unable to generate MIDI.");
      setStatus("Generation failed.");
    } finally {
      setIsGenerating(false);
    }
  }

  async function playPreview() {
    if (!latestPlanRef.current) {
      setError("Generate a MIDI file first.");
      return;
    }

    setError("");
    setStatus("Playing piano preview...");

    try {
      await previewMidiPlan(latestPlanRef.current, bpm, selectedKey);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Unable to play preview.");
      setStatus("Preview failed.");
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <p className="eyebrow">OpenAI MIDI Sketchpad</p>
        <h1>Generate piano MIDI from sentiment, tempo, bars, and key.</h1>
        <p className="hero-copy">
          Describe the mood, pick the musical frame, and export a single-track piano MIDI loop ready for your DAW.
        </p>
      </section>

      <section className="workspace-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Credentials</p>
              <h2>OpenAI API Key</h2>
            </div>
            <span className={`status-chip ${savedApiKey ? "active" : ""}`}>{savedApiKey ? "Saved" : "Missing"}</span>
          </div>

          <div className="field-stack">
            <label className="field">
              <span>API key</span>
              <input
                autoComplete="off"
                onChange={(event) => setApiKeyDraft(event.target.value)}
                placeholder="sk-..."
                type="password"
                value={apiKeyDraft}
              />
            </label>

            <div className="button-row">
              <button className="primary-button" onClick={saveApiKey} type="button">
                Save key
              </button>
              <button className="ghost-button" disabled={!savedApiKey} onClick={clearApiKey} type="button">
                Remove key
              </button>
            </div>
          </div>
        </div>

        <div className="panel panel-large">
          <div className="panel-head">
            <div>
              <p className="eyebrow">Prompt</p>
              <h2>MIDI Generator</h2>
            </div>
          </div>

          <div className="field-stack">
            <label className="field">
              <span>Sentiment</span>
              <textarea
                onChange={(event) => setSentiment(event.target.value)}
                placeholder="Describe the feeling, movement, tension, and energy."
                rows={6}
                value={sentiment}
              />
            </label>

            <div className="select-grid">
              <label className="field">
                <span>BPM</span>
                <select onChange={(event) => setBpm(Number(event.target.value))} value={bpm}>
                  {BPM_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Bars</span>
                <select onChange={(event) => setBars(Number(event.target.value))} value={bars}>
                  {BAR_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Key</span>
                <select onChange={(event) => setKeyId(event.target.value)} value={keyId}>
                  {KEY_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="button-row">
              <button className="primary-button generate-button" disabled={isGenerating || !savedApiKey} onClick={() => void generateMidi()} type="button">
                {isGenerating ? "Generating..." : "Generate MIDI"}
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="panel footer-panel">
        <div className="panel-head">
          <div>
            <p className="eyebrow">Result</p>
            <h2>Export</h2>
          </div>
        </div>

        <p className="status-line">{status}</p>
        {error ? <p className="error-line">{error}</p> : null}

        {generatedMidi ? (
          <div className="result-card">
            <div>
              <strong>{generatedMidi.title}</strong>
              <p>
                {generatedMidi.noteCount} notes • {selectedKey.label} • {bars} bars • {bpm} BPM
              </p>
            </div>
            <div className="button-row">
              <button className="ghost-button" onClick={() => void playPreview()} type="button">
                Play preview
              </button>
              <a className="download-link" download={generatedMidi.fileName} href={generatedMidi.url}>
                Download MIDI
              </a>
            </div>
          </div>
        ) : (
          <div className="empty-card">
            <strong>No MIDI generated yet.</strong>
            <p>Once the model returns a valid melody plan, the app will build a standard piano `.mid` file here.</p>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
