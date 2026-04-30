import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { SettingsForm } from "./components/SettingsForm";
import { TrackCard } from "./components/TrackCard";
import { downloadAllTracksMidi } from "./lib/midiGenerator";
import { generateMusicData } from "./lib/openai";
import { playAllTracks, stopPlayback } from "./lib/playback";
import type { GeneratedMidiData, GenerationSettings, PlaybackMode, TrackName } from "./types/music";

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
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode | null>(null);
  const globalStopTimerRef = useRef<number | null>(null);

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
      if (globalStopTimerRef.current) {
        window.clearTimeout(globalStopTimerRef.current);
      }
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
    setPlaybackMode(null);
    if (globalStopTimerRef.current) {
      window.clearTimeout(globalStopTimerRef.current);
      globalStopTimerRef.current = null;
    }
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

  async function handlePlayAll() {
    if (!generatedData) {
      return;
    }

    if (globalStopTimerRef.current) {
      window.clearTimeout(globalStopTimerRef.current);
    }

    const durationMs = await playAllTracks(generatedData);
    setActiveTrack(null);
    setPlaybackMode("all");

    globalStopTimerRef.current = window.setTimeout(() => {
      setPlaybackMode(null);
      globalStopTimerRef.current = null;
    }, durationMs + 150);
  }

  function handleStopAll() {
    if (globalStopTimerRef.current) {
      window.clearTimeout(globalStopTimerRef.current);
      globalStopTimerRef.current = null;
    }

    stopPlayback();
    setActiveTrack(null);
    setPlaybackMode(null);
  }

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">Tauri MIDI Composer</span>
          <h1>GenMIDI.</h1>
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
            <div className="results-controls">
              <div className="meta-pill">
                {generatedData.key} {generatedData.scale} · {generatedData.bpm} BPM
              </div>
              <button
                type="button"
                className={`secondary-button ${playbackMode === "all" ? "active" : ""}`}
                onClick={handlePlayAll}
              >
                Play tutte
              </button>
              <button type="button" className="secondary-button" onClick={handleStopAll}>
                Stop generale
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void downloadAllTracksMidi(generatedData.tracks, generatedData.bpm)}
              >
                Download tutte
              </button>
            </div>
          </div>

          <div className="track-grid">
            <TrackCard
              trackName="arpeggiator"
              events={tracks.arpeggiator}
              bpm={generatedData.bpm}
              isPlaying={activeTrack === "arpeggiator" || playbackMode === "all"}
              onPlay={() => {
                if (globalStopTimerRef.current) {
                  window.clearTimeout(globalStopTimerRef.current);
                  globalStopTimerRef.current = null;
                }
                setPlaybackMode("single");
                setActiveTrack("arpeggiator");
              }}
              onStop={() => {
                setActiveTrack(null);
                setPlaybackMode(null);
              }}
            />
            <TrackCard
              trackName="chords"
              events={tracks.chords}
              bpm={generatedData.bpm}
              isPlaying={activeTrack === "chords" || playbackMode === "all"}
              onPlay={() => {
                if (globalStopTimerRef.current) {
                  window.clearTimeout(globalStopTimerRef.current);
                  globalStopTimerRef.current = null;
                }
                setPlaybackMode("single");
                setActiveTrack("chords");
              }}
              onStop={() => {
                setActiveTrack(null);
                setPlaybackMode(null);
              }}
            />
            <TrackCard
              trackName="vocal"
              events={tracks.vocal}
              bpm={generatedData.bpm}
              isPlaying={activeTrack === "vocal" || playbackMode === "all"}
              onPlay={() => {
                if (globalStopTimerRef.current) {
                  window.clearTimeout(globalStopTimerRef.current);
                  globalStopTimerRef.current = null;
                }
                setPlaybackMode("single");
                setActiveTrack("vocal");
              }}
              onStop={() => {
                setActiveTrack(null);
                setPlaybackMode(null);
              }}
            />
            <TrackCard
              trackName="string"
              events={tracks.string}
              bpm={generatedData.bpm}
              isPlaying={activeTrack === "string" || playbackMode === "all"}
              onPlay={() => {
                if (globalStopTimerRef.current) {
                  window.clearTimeout(globalStopTimerRef.current);
                  globalStopTimerRef.current = null;
                }
                setPlaybackMode("single");
                setActiveTrack("string");
              }}
              onStop={() => {
                setActiveTrack(null);
                setPlaybackMode(null);
              }}
            />
          </div>
        </section>
      ) : null}
    </main>
  );
}

export default App;
