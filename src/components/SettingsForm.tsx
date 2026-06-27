import type { FormEvent } from "react";
import type { ChangeEvent } from "react";
import type { GenerationSettings, MusicalKey, MusicalScale, ReferenceAnalysis } from "../types/music";

const KEYS: MusicalKey[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES: MusicalScale[] = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian"];
const BARS = [4, 8, 16, 32] as const;

type SettingsFormProps = {
  settings: GenerationSettings;
  isGenerating: boolean;
  isAnalyzingReference: boolean;
  analysisError: string | null;
  onChange: (settings: GenerationSettings) => void;
  onSubmit: () => void;
  onReferenceFileChange: (file: File | null) => void;
  onReferenceAnalysisClear: () => void;
};

export function SettingsForm({
  settings,
  isGenerating,
  isAnalyzingReference,
  analysisError,
  onChange,
  onSubmit,
  onReferenceFileChange,
  onReferenceAnalysisClear,
}: SettingsFormProps) {
  function patch<K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

  function handleReferenceUpload(event: ChangeEvent<HTMLInputElement>) {
    onReferenceFileChange(event.currentTarget.files?.[0] ?? null);
    event.currentTarget.value = "";
  }

  const barOptions = settings.referenceAnalysis
    ? Array.from(new Set([...BARS, settings.referenceAnalysis.estimatedBars])).sort((a, b) => a - b)
    : [...BARS];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="settings-card" onSubmit={handleSubmit}>
      <label className="field">
        <span>OpenAI API Key</span>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(event) => patch("apiKey", event.currentTarget.value)}
          placeholder="sk-..."
          autoComplete="off"
        />
      </label>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={settings.saveApiKey}
          onChange={(event) => patch("saveApiKey", event.currentTarget.checked)}
        />
        <span>Salva localmente la key per questo MVP</span>
      </label>

      <div className="field-grid">
        <label className="field">
          <span>BPM</span>
          <input
            type="number"
            min={40}
            max={240}
            value={settings.bpm}
            onChange={(event) => patch("bpm", Number(event.currentTarget.value))}
            disabled={Boolean(settings.referenceAnalysis)}
          />
        </label>

        <label className="field">
          <span>Tonalita</span>
          <select
            value={settings.key}
            onChange={(event) => patch("key", event.currentTarget.value as MusicalKey)}
            disabled={Boolean(settings.referenceAnalysis)}
          >
            {KEYS.map((keyOption) => (
              <option key={keyOption} value={keyOption}>
                {keyOption}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Scala</span>
          <select
            value={settings.scale}
            onChange={(event) => patch("scale", event.currentTarget.value as MusicalScale)}
            disabled={Boolean(settings.referenceAnalysis)}
          >
            {SCALES.map((scaleOption) => (
              <option key={scaleOption} value={scaleOption}>
                {scaleOption}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span>Durata battute</span>
          <select
            value={settings.bars}
            onChange={(event) => patch("bars", Number(event.currentTarget.value))}
            disabled={Boolean(settings.referenceAnalysis)}
          >
            {barOptions.map((bars) => (
              <option key={bars} value={bars}>
                {bars}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="reference-panel">
        <div className="reference-panel-header">
          <div>
            <span>Reference song</span>
            <small className="field-hint">
              Carica un brano: il sistema analizza il file e genera subito le tracce MIDI seguendo gli accordi rilevati.
            </small>
          </div>
          {settings.referenceAnalysis ? (
            <button type="button" className="secondary-button compact-button" onClick={onReferenceAnalysisClear}>
              Rimuovi
            </button>
          ) : null}
        </div>

        <label className="upload-field">
          <input
            type="file"
            accept=".mp3,.wav,.m4a,.aac,.ogg,.flac,.mp4,audio/*"
            onChange={handleReferenceUpload}
            disabled={isAnalyzingReference}
          />
          <span>{isAnalyzingReference ? "Analisi audio in corso..." : "Seleziona file audio"}</span>
        </label>

        {analysisError ? <div className="inline-status error">{analysisError}</div> : null}
        {settings.referenceAnalysis ? <ReferenceSummary analysis={settings.referenceAnalysis} /> : null}
      </div>

      <label className="field">
        <span>Creativita {settings.creativity}%</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={settings.creativity}
          onChange={(event) => patch("creativity", Number(event.currentTarget.value))}
          disabled={Boolean(settings.referenceAnalysis)}
        />
        <small className="field-hint">
          {settings.referenceAnalysis
            ? "Ignorata quando usi una reference song."
            : "Valori alti producono take piu vari, artistici e meno prevedibili anche con lo stesso prompt."}
        </small>
      </label>

      <label className="field">
        <span>Prompt musicale</span>
        <textarea
          rows={6}
          value={settings.prompt}
          onChange={(event) => patch("prompt", event.currentTarget.value)}
          placeholder="Deep house emotiva, arpeggiatore veloce, accordi caldi..."
          disabled={Boolean(settings.referenceAnalysis)}
        />
      </label>

      <button className="primary-button" type="submit" disabled={isGenerating}>
        {isGenerating ? "Generazione in corso..." : "Genera tracce MIDI"}
      </button>
    </form>
  );
}

function ReferenceSummary({ analysis }: { analysis: ReferenceAnalysis }) {
  const confidenceClass = analysis.confidenceLabel === "low" ? "warning" : "success";

  return (
    <div className="reference-summary">
      <div className="reference-meta-grid">
        <div className="meta-chip">{analysis.sourceFileName}</div>
        <div className="meta-chip">
          {analysis.bpm} BPM · {analysis.key} {analysis.scale}
        </div>
        <div className={`meta-chip ${confidenceClass}`}>
          Affidabilita {Math.round(analysis.confidence * 100)}%
        </div>
      </div>

      <small className="field-hint">
        In modalita reference vengono ignorati prompt, creativita e impostazioni armoniche manuali. La pipeline usa
        direttamente il file analizzato.
      </small>

      <div className="reference-list">
        {analysis.chordTimeline.slice(0, 8).map((segment) => (
          <div key={`${segment.startTime}-${segment.chord}`} className="reference-row">
            <strong>{segment.chord}</strong>
            <span>
              {segment.startTime.toFixed(1)}s - {segment.endTime.toFixed(1)}s
            </span>
            <span>{Math.round(segment.confidence * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
