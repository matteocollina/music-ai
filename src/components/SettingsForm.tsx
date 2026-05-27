import type { FormEvent } from "react";
import type { GenerationSettings, MusicalKey, MusicalScale } from "../types/music";

const KEYS: MusicalKey[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const SCALES: MusicalScale[] = ["major", "minor", "dorian", "phrygian", "lydian", "mixolydian"];
const BARS = [4, 8, 16, 32] as const;

type SettingsFormProps = {
  settings: GenerationSettings;
  isGenerating: boolean;
  onChange: (settings: GenerationSettings) => void;
  onSubmit: () => void;
};

export function SettingsForm({ settings, isGenerating, onChange, onSubmit }: SettingsFormProps) {
  function patch<K extends keyof GenerationSettings>(key: K, value: GenerationSettings[K]) {
    onChange({ ...settings, [key]: value });
  }

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
          />
        </label>

        <label className="field">
          <span>Tonalita</span>
          <select value={settings.key} onChange={(event) => patch("key", event.currentTarget.value as MusicalKey)}>
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
          <select value={settings.bars} onChange={(event) => patch("bars", Number(event.currentTarget.value))}>
            {BARS.map((bars) => (
              <option key={bars} value={bars}>
                {bars}
              </option>
            ))}
          </select>
        </label>
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
        />
        <small className="field-hint">
          Valori alti producono take piu vari, artistici e meno prevedibili anche con lo stesso prompt.
        </small>
      </label>

      <label className="field">
        <span>Prompt musicale</span>
        <textarea
          rows={6}
          value={settings.prompt}
          onChange={(event) => patch("prompt", event.currentTarget.value)}
          placeholder="Deep house emotiva, arpeggiatore veloce, accordi caldi..."
        />
      </label>

      <button className="primary-button" type="submit" disabled={isGenerating}>
        {isGenerating ? "Generazione in corso..." : "Genera tracce MIDI"}
      </button>
    </form>
  );
}
