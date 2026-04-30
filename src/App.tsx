import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { SettingsForm } from "./components/SettingsForm";
import { TrackCard } from "./components/TrackCard";
import { generateMusicData } from "./lib/openai";
import { stopPlayback } from "./lib/playback";
import type { GeneratedMidiData, GenerationSettings, TrackName } from "./types/music";

const STORAGE_KEY = "music-ai-settings";

const defaultSettings: GenerationSettings = {
  apiKey: "",
  saveApiKey: true,
  bpm: 120,
  key: "C",
  scale: "minor",
  bars: 8,
  prompt:
    "Deep house emotiva, arpeggiatore veloce, accordi caldi, vocal chop melodico, string pad cinematico",
};

function App() {
  const [settings, setSettings] = useState<GenerationSettings>(defaultSettings);
  const [generatedData, setGeneratedData] = useState<GeneratedMidiData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTrack, setActiveTrack] = useState<TrackName | null>(null);

  useEffect(() => {
    const rawSettings = window.localStorage.getItem(STORAGE_KEY);

    if (!rawSettings) {
      return;
    }

    try {
      const savedSettings = JSON.parse(rawSettings) as Partial<GenerationSettings>;
      setSettings((current) => ({
        ...current,
        ...savedSettings,
        apiKey: typeof savedSettings.apiKey === "string" ? savedSettings.apiKey : "",
        saveApiKey: savedSettings.saveApiKey ?? true,
      }));
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  useEffect(
    () => () => {
      stopPlayback();
    },
    [],
  );

  const tracks = useMemo(() => generatedData?.tracks ?? null, [generatedData]);

  function updateSettings(nextSettings: GenerationSettings) {
    setSettings(nextSettings);

    const payload: Partial<GenerationSettings> = nextSettings.saveApiKey
      ? nextSettings
      : { ...nextSettings, apiKey: "" };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  async function handleGenerate() {
    if (!settings.apiKey.trim()) {
      setError("Inserisci una OpenAI API Key prima di generare le tracce.");
      return;
    }

    setIsGenerating(true);
    setError(null);
    setGeneratedData(null);
    setActiveTrack(null);
    stopPlayback();

    try {
      const result = await generateMusicData(settings);
      setGeneratedData(result);
    } catch (generationError) {
      const message =
        generationError instanceof Error
          ? generationError.message
          : "Errore sconosciuto durante la generazione MIDI.";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Tauri MIDI Composer</span>
          <h1>Genera quattro tracce MIDI separate da un singolo prompt musicale.</h1>
          <p>
            Definisci API key, BPM, tonalita e mood. L&apos;app usa OpenAI per creare
            arpeggiatore, chords, vocal e string in formato esportabile `.mid`.
          </p>
        </div>
        <SettingsForm
          settings={settings}
          isGenerating={isGenerating}
          onChange={updateSettings}
          onSubmit={handleGenerate}
        />
      </section>

      {error ? <div className="status-banner error">{error}</div> : null}
      {isGenerating ? (
        <div className="status-banner loading">Generazione in corso. Sto costruendo le quattro tracce MIDI.</div>
      ) : null}

      {generatedData && tracks ? (
        <section className="results-section">
          <div className="results-header">
            <div>
              <span className="eyebrow">Output</span>
              <h2>Tracce generate</h2>
            </div>
            <div className="meta-pill">
              {generatedData.key} {generatedData.scale} · {generatedData.bpm} BPM
            </div>
          </div>

          <div className="track-grid">
            <TrackCard
              trackName="arpeggiator"
              events={tracks.arpeggiator}
              bpm={generatedData.bpm}
              isPlaying={activeTrack === "arpeggiator"}
              onPlay={() => setActiveTrack("arpeggiator")}
              onStop={() => setActiveTrack(null)}
            />
            <TrackCard
              trackName="chords"
              events={tracks.chords}
              bpm={generatedData.bpm}
              isPlaying={activeTrack === "chords"}
              onPlay={() => setActiveTrack("chords")}
              onStop={() => setActiveTrack(null)}
            />
            <TrackCard
              trackName="vocal"
              events={tracks.vocal}
              bpm={generatedData.bpm}
              isPlaying={activeTrack === "vocal"}
              onPlay={() => setActiveTrack("vocal")}
              onStop={() => setActiveTrack(null)}
            />
            <TrackCard
              trackName="string"
              events={tracks.string}
              bpm={generatedData.bpm}
              isPlaying={activeTrack === "string"}
              onPlay={() => setActiveTrack("string")}
              onStop={() => setActiveTrack(null)}
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;
