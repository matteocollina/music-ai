import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";
import { SettingsForm } from "./components/SettingsForm";
import { TrackCard } from "./components/TrackCard";
import { analyzeReferenceAudio } from "./lib/audioAnalysis";
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
  creativity: 78,
  prompt:
    "Deep house emotiva, arpeggiatore veloce, accordi caldi, vocal chop melodico, string pad cinematico",
  referenceAnalysis: null,
};

function App() {
  const [settings, setSettings] = useState<GenerationSettings>(defaultSettings);
  const [generatedData, setGeneratedData] = useState<GeneratedMidiData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzingReference, setIsAnalyzingReference] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [activeTrack, setActiveTrack] = useState<TrackName | null>(null);
  const [playbackMode, setPlaybackMode] = useState<PlaybackMode | null>(null);
  const globalStopTimerRef = useRef<number | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  async function runGeneration(sourceSettings: GenerationSettings) {
    if (!sourceSettings.apiKey.trim()) {
      setError("Inserisci una OpenAI API Key prima di generare le tracce.");
      return;
    }

    const effectiveSettings = sourceSettings.referenceAnalysis
      ? {
          ...sourceSettings,
          bpm: sourceSettings.referenceAnalysis.bpm,
          key: sourceSettings.referenceAnalysis.key,
          scale: sourceSettings.referenceAnalysis.scale,
          bars: sourceSettings.referenceAnalysis.estimatedBars,
          creativity: defaultSettings.creativity,
          prompt: "",
        }
      : sourceSettings;

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
      const result = await generateMusicData(effectiveSettings);
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
        referenceAnalysis: null,
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

    const persistedSettings = { ...nextSettings, referenceAnalysis: null };
    const payload: Partial<GenerationSettings> = nextSettings.saveApiKey
      ? persistedSettings
      : { ...persistedSettings, apiKey: "" };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }

  async function handleReferenceFileChange(file: File | null) {
    setAnalysisError(null);

    if (!file) {
      return;
    }

    setIsAnalyzingReference(true);

    try {
      const analysis = await analyzeReferenceAudio(file);
      const nextSettings = {
        ...settingsRef.current,
        bpm: analysis.bpm,
        key: analysis.key,
        scale: analysis.scale,
        bars: analysis.estimatedBars,
        referenceAnalysis: analysis,
      };
      updateSettings(nextSettings);
      await runGeneration(nextSettings);
    } catch (analysisFailure) {
      const message =
        analysisFailure instanceof Error
          ? analysisFailure.message
          : "Impossibile analizzare il file audio selezionato.";
      setAnalysisError(message);
    } finally {
      setIsAnalyzingReference(false);
    }
  }

  function clearReferenceAnalysis() {
    setAnalysisError(null);
    updateSettings({ ...settingsRef.current, referenceAnalysis: null });
  }

  async function handleGenerate() {
    await runGeneration(settings);
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
          isAnalyzingReference={isAnalyzingReference}
          analysisError={analysisError}
          onChange={updateSettings}
          onSubmit={handleGenerate}
          onReferenceFileChange={(file) => void handleReferenceFileChange(file)}
          onReferenceAnalysisClear={clearReferenceAnalysis}
        />
      </section>

      {error ? <div className="status-banner error">{error}</div> : null}
      {isGenerating ? (
        <div className="status-banner loading">Generazione in corso. Sto costruendo le quattro tracce MIDI.</div>
      ) : null}
      {settings.referenceAnalysis?.confidenceLabel === "low" ? (
        <div className="status-banner warning">
          Progressione reference rilevata con bassa affidabilita. La generazione resta disponibile, ma gli accordi
          estratti potrebbero non essere perfetti.
        </div>
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
              {settings.referenceAnalysis ? (
                <div className="meta-pill subtle-pill">
                  Reference chords: {settings.referenceAnalysis.sourceFileName}
                </div>
              ) : null}
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
