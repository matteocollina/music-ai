import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import * as Tone from "tone";
import { Midi } from "@tonejs/midi";
import "./App.css";

type LoopKind = "audio" | "midi";

type ApiKeyStatus = {
  configured: boolean;
  last_four: string | null;
};

type MidiPreviewNote = {
  duration: number;
  midi: number;
  time: number;
  velocity: number;
};

type ScheduledMidiNote = {
  durationSeconds: number;
  midi: number;
  time: number;
  velocity: number;
};

type LoopClip = {
  bars: number;
  color: string;
  fileName: string;
  id: string;
  kind: LoopKind;
  lane: string;
  muted: boolean;
  name: string;
  sourceBpm: number;
  startBar: number;
  volume: number;
  waveform: number[];
  midiPreview: MidiPreviewNote[];
  durationSeconds: number;
  objectUrl: string;
};

type EngineHandle = {
  dispose: () => void;
  parts: Tone.Part[];
  players: Tone.Player[];
  raf: number | null;
  synths: Tone.PolySynth[];
  volumes: Tone.Volume[];
};

const palette = [
  "#ff7a18",
  "#ffb703",
  "#ff4d6d",
  "#3ddc97",
  "#5ea1ff",
  "#ff8fab",
  "#7c5cff",
];

const defaultLanes = ["Vocals", "Drums", "Bass", "Synth", "FX"];
const visibleBars = 8;
const transportNumerator = 4;

function createEmptyEngine(): EngineHandle {
  return {
    dispose: () => undefined,
    parts: [],
    players: [],
    raf: null,
    synths: [],
    volumes: [],
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function deriveBars(durationSeconds: number, bpm: number) {
  const barDuration = (60 / bpm) * transportNumerator;
  return Math.max(1, Math.round(durationSeconds / barDuration));
}

function inferLane(name: string, kind: LoopKind) {
  const normalized = name.toLowerCase();
  if (normalized.includes("drum") || normalized.includes("kick") || normalized.includes("snare")) return "Drums";
  if (normalized.includes("bass")) return "Bass";
  if (normalized.includes("lead") || normalized.includes("pad") || normalized.includes("synth")) return "Synth";
  if (normalized.includes("vox") || normalized.includes("vocal") || normalized.includes("voice")) return "Vocals";
  if (kind === "midi") return "Synth";
  return "FX";
}

function createId() {
  return crypto.randomUUID();
}

function pickColor(seed: number) {
  return palette[seed % palette.length];
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const secs = (safe % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function buildWaveform(buffer: AudioBuffer, points = 52) {
  const channel = buffer.getChannelData(0);
  const segment = Math.max(1, Math.floor(channel.length / points));
  const values: number[] = [];

  for (let index = 0; index < points; index += 1) {
    let peak = 0;
    const start = index * segment;
    const end = Math.min(channel.length, start + segment);

    for (let cursor = start; cursor < end; cursor += 1) {
      peak = Math.max(peak, Math.abs(channel[cursor] ?? 0));
    }

    values.push(clamp(peak, 0.08, 1));
  }

  return values;
}

function buildMidiPreview(midi: Midi) {
  const notes = midi.tracks.flatMap((track) =>
    track.notes.map((note) => ({
      duration: note.duration,
      midi: note.midi,
      time: note.time,
      velocity: note.velocity,
    })),
  );

  return notes.sort((left, right) => left.time - right.time).slice(0, 64);
}

function durationToBeats(durationSeconds: number, bpm: number) {
  return (durationSeconds * bpm) / 60;
}

function dbFromVolume(volume: number, muted: boolean) {
  if (muted) return -96;
  return Tone.gainToDb(clamp(volume, 0.001, 1));
}

async function loadAudioClip(file: File, bpm: number, index: number): Promise<LoopClip> {
  const objectUrl = URL.createObjectURL(file);
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = Tone.getContext().rawContext;
  const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  const sourceBpm = bpm;
  const bars = deriveBars(decoded.duration, sourceBpm);

  return {
    bars,
    color: pickColor(index),
    durationSeconds: decoded.duration,
    fileName: file.name,
    id: createId(),
    kind: "audio",
    lane: inferLane(file.name, "audio"),
    midiPreview: [],
    muted: false,
    name: file.name.replace(/\.[^.]+$/, ""),
    objectUrl,
    sourceBpm,
    startBar: 0,
    volume: 0.82,
    waveform: buildWaveform(decoded),
  };
}

async function loadMidiClip(file: File, bpm: number, index: number): Promise<LoopClip> {
  const objectUrl = URL.createObjectURL(file);
  const arrayBuffer = await file.arrayBuffer();
  const midi = new Midi(arrayBuffer);
  const sourceBpm = Math.round(midi.header.tempos[0]?.bpm ?? bpm);
  const bars = deriveBars(midi.duration, sourceBpm);

  return {
    bars,
    color: pickColor(index),
    durationSeconds: midi.duration,
    fileName: file.name,
    id: createId(),
    kind: "midi",
    lane: inferLane(file.name, "midi"),
    midiPreview: buildMidiPreview(midi),
    muted: false,
    name: file.name.replace(/\.[^.]+$/, ""),
    objectUrl,
    sourceBpm,
    startBar: 0,
    volume: 0.76,
    waveform: [],
  };
}

async function readClipFromFile(file: File, bpm: number, index: number) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".mid") || lower.endsWith(".midi")) {
    return loadMidiClip(file, bpm, index);
  }

  return loadAudioClip(file, bpm, index);
}

function sumBars(clip: LoopClip) {
  return clip.startBar + clip.bars;
}

function usePersistentNumber(key: string, initialValue: number) {
  const [value, setValue] = useState(() => {
    const saved = window.localStorage.getItem(key);
    const parsed = saved ? Number(saved) : initialValue;
    return Number.isFinite(parsed) ? parsed : initialValue;
  });

  useEffect(() => {
    window.localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue] as const;
}

function App() {
  const [bpm, setBpm] = usePersistentNumber("music-ai:bpm", 124);
  const [clips, setClips] = useState<LoopClip[]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus>({ configured: false, last_four: null });
  const [apiBusy, setApiBusy] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [transportBar, setTransportBar] = useState(0);
  const [statusLine, setStatusLine] = useState("Ready. Drop loops or browse files to start arranging.");
  const [errorLine, setErrorLine] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const engineRef = useRef<EngineHandle>(createEmptyEngine());

  const lanes = useMemo(() => {
    const dynamic = clips.map((clip) => clip.lane.trim()).filter(Boolean);
    return Array.from(new Set([...defaultLanes, ...dynamic]));
  }, [clips]);

  const selectedClip = useMemo(
    () => clips.find((clip) => clip.id === selectedClipId) ?? clips[0] ?? null,
    [clips, selectedClipId],
  );

  const maxBars = useMemo(() => {
    const clipBars = clips.length ? Math.max(...clips.map(sumBars)) : 0;
    return Math.max(visibleBars, clipBars + 2);
  }, [clips]);

  useEffect(() => {
    void refreshApiKeyStatus();

    return () => {
      stopPlayback();
      clips.forEach((clip) => URL.revokeObjectURL(clip.objectUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshApiKeyStatus() {
    try {
      const status = await invoke<ApiKeyStatus>("get_api_key_status");
      setApiKeyStatus(status);
    } catch (error) {
      setErrorLine(String(error));
    }
  }

  function destroyEngine() {
    if (engineRef.current.raf !== null) {
      window.cancelAnimationFrame(engineRef.current.raf);
    }

    engineRef.current.parts.forEach((part) => part.dispose());
    engineRef.current.players.forEach((player) => player.dispose());
    engineRef.current.synths.forEach((synth) => synth.dispose());
    engineRef.current.volumes.forEach((volume) => volume.dispose());
    engineRef.current.dispose();
    engineRef.current = createEmptyEngine();
  }

  function stopPlayback() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    Tone.Transport.position = "0:0:0";
    destroyEngine();
    setTransportBar(0);
    setIsPlaying(false);
  }

  function tickPlayhead() {
    const secondsPerBar = (60 / bpm) * transportNumerator;
    const nextBar = (Tone.Transport.seconds / secondsPerBar) % visibleBars;
    setTransportBar(nextBar);
    engineRef.current.raf = window.requestAnimationFrame(tickPlayhead);
  }

  async function startPlayback() {
    if (!clips.length) {
      setStatusLine("Import at least one loop before starting playback.");
      return;
    }

    await Tone.start();
    stopPlayback();

    const players: Tone.Player[] = [];
    const parts: Tone.Part[] = [];
    const synths: Tone.PolySynth[] = [];
    const volumes: Tone.Volume[] = [];

    Tone.Transport.bpm.value = bpm;
    Tone.Transport.loop = true;
    Tone.Transport.loopStart = 0;
    Tone.Transport.loopEnd = `${maxBars}m`;

    for (const clip of clips) {
      const startSeconds = clip.startBar * transportNumerator * (60 / bpm);
      const volumeNode = new Tone.Volume(dbFromVolume(clip.volume, clip.muted)).toDestination();
      volumes.push(volumeNode);

      if (clip.kind === "audio") {
        const player = new Tone.Player({
          autostart: false,
          loop: true,
          url: clip.objectUrl,
        }).connect(volumeNode);

        await player.load(clip.objectUrl);
        player.playbackRate = bpm / clip.sourceBpm;
        player.sync().start(startSeconds);
        players.push(player);
      } else {
        const midi = await Midi.fromUrl(clip.objectUrl);
        const synth = new Tone.PolySynth(Tone.Synth, {
          envelope: { attack: 0.01, decay: 0.08, release: 0.25, sustain: 0.35 },
          oscillator: { type: "sawtooth6" },
        }).connect(volumeNode);

        const events: ScheduledMidiNote[] = midi.tracks.flatMap((track) =>
          track.notes.map((note) => {
            const noteBeats = durationToBeats(note.time, clip.sourceBpm);
            const durationBeats = durationToBeats(note.duration, clip.sourceBpm);

            return {
              durationSeconds: durationBeats * (60 / bpm),
              midi: note.midi,
              time: noteBeats * (60 / bpm),
              velocity: note.velocity,
            };
          }),
        );

        const loopSeconds = clip.bars * transportNumerator * (60 / bpm);
        const part = new Tone.Part((time, value: ScheduledMidiNote) => {
          synth.triggerAttackRelease(Tone.Frequency(value.midi, "midi").toNote(), value.durationSeconds, time, value.velocity);
        }, events)
          .start(startSeconds)
          .set({
            loop: true,
            loopEnd: loopSeconds,
          });

        parts.push(part);
        synths.push(synth);
      }
    }

    engineRef.current = {
      dispose: () => undefined,
      parts,
      players,
      raf: window.requestAnimationFrame(tickPlayhead),
      synths,
      volumes,
    };

    Tone.Transport.start("+0.01");
    setIsPlaying(true);
    setStatusLine(`Playback running at ${bpm} BPM.`);
  }

  async function handleFileSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    await importFiles(files);
    event.target.value = "";
  }

  async function importFiles(files: File[]) {
    if (!files.length) return;

    setErrorLine("");
    const imported: LoopClip[] = [];

    try {
      for (let index = 0; index < files.length; index += 1) {
        const clip = await readClipFromFile(files[index], bpm, clips.length + index);
        imported.push(clip);
      }

      setClips((current) => {
        const next = [...current, ...imported];
        setSelectedClipId((selected) => selected ?? imported[0]?.id ?? null);
        return next;
      });
      setStatusLine(`Imported ${imported.length} loop${imported.length > 1 ? "s" : ""}.`);
    } catch (error) {
      imported.forEach((clip) => URL.revokeObjectURL(clip.objectUrl));
      setErrorLine(`Import failed: ${String(error)}`);
    }
  }

  function updateClip(id: string, patch: Partial<LoopClip>) {
    setClips((current) => current.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)));
  }

  function removeClip(id: string) {
    setClips((current) => {
      const clip = current.find((entry) => entry.id === id);
      if (clip) URL.revokeObjectURL(clip.objectUrl);
      const next = current.filter((entry) => entry.id !== id);
      if (selectedClipId === id) setSelectedClipId(next[0]?.id ?? null);
      return next;
    });
  }

  async function saveApiKey() {
    if (!apiKeyInput.trim()) {
      setErrorLine("Enter a key before saving.");
      return;
    }

    setApiBusy(true);
    setErrorLine("");

    try {
      await invoke("save_api_key", { apiKey: apiKeyInput.trim() });
      setApiKeyInput("");
      await refreshApiKeyStatus();
      setStatusLine("OpenAI API key stored locally in the Tauri app data directory.");
    } catch (error) {
      setErrorLine(`Unable to save API key: ${String(error)}`);
    } finally {
      setApiBusy(false);
    }
  }

  async function deleteApiKey() {
    setApiBusy(true);
    setErrorLine("");

    try {
      await invoke("delete_api_key");
      await refreshApiKeyStatus();
      setStatusLine("Stored API key removed from local secure storage.");
    } catch (error) {
      setErrorLine(`Unable to delete API key: ${String(error)}`);
    } finally {
      setApiBusy(false);
    }
  }

  return (
    <div
      className="studio-shell"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void importFiles(Array.from(event.dataTransfer.files));
      }}
    >
      <aside className="sidebar">
        <div className="brand-card panel">
          <div className="brand-mark">S</div>
          <div>
            <p className="eyebrow">Desktop music workstation</p>
            <h1>Studio Compose</h1>
          </div>
        </div>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Project tempo</p>
              <h2>Global BPM</h2>
            </div>
            <button
              className="ghost-button"
              onClick={() => {
                if (isPlaying) stopPlayback();
                setBpm(124);
              }}
              type="button"
            >
              Reset
            </button>
          </div>

          <div className="bpm-card">
            <div>
              <div className="bpm-value">{bpm}</div>
              <p className="helper">Every loop is scheduled against this transport.</p>
            </div>
            <input
              className="slider"
              max={180}
              min={70}
              onChange={(event) => {
                if (isPlaying) stopPlayback();
                setBpm(Number(event.target.value));
              }}
              type="range"
              value={bpm}
            />
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Secrets</p>
              <h2>OpenAI API Key</h2>
            </div>
            <span className={`status-pill ${apiKeyStatus.configured ? "configured" : ""}`}>
              {apiKeyStatus.configured ? `Saved ••••${apiKeyStatus.last_four ?? ""}` : "Not configured"}
            </span>
          </div>
          <p className="helper">
            Stored locally through Tauri commands. The key never lives in browser localStorage.
          </p>
          <div className="api-row">
            <input
              autoComplete="off"
              onChange={(event) => setApiKeyInput(event.target.value)}
              placeholder="sk-..."
              type="password"
              value={apiKeyInput}
            />
            <button className="primary-button" disabled={apiBusy} onClick={() => void saveApiKey()} type="button">
              Save
            </button>
          </div>
          <button className="ghost-button full-width" disabled={!apiKeyStatus.configured || apiBusy} onClick={() => void deleteApiKey()} type="button">
            Remove saved key
          </button>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Assets</p>
              <h2>Loop Library</h2>
            </div>
            <button className="primary-button" onClick={() => fileInputRef.current?.click()} type="button">
              Import
            </button>
          </div>
          <input
            accept=".wav,.mp3,.mid,.midi,audio/wav,audio/mpeg"
            hidden
            multiple
            onChange={(event) => void handleFileSelection(event)}
            ref={fileInputRef}
            type="file"
          />
          <p className="helper">WAV, MP3, MID and MIDI are supported. Drag files anywhere onto the app.</p>

          <div className="clip-list">
            {clips.length === 0 ? (
              <div className="empty-card">No loops yet. Import audio or MIDI clips to populate the arranger.</div>
            ) : (
              clips.map((clip) => (
                <button
                  className={`clip-card ${selectedClip?.id === clip.id ? "selected" : ""}`}
                  key={clip.id}
                  onClick={() => setSelectedClipId(clip.id)}
                  type="button"
                >
                  <div className="clip-card-head">
                    <div className="clip-swatch" style={{ background: clip.color }} />
                    <div>
                      <strong>{clip.name}</strong>
                      <p>
                        {clip.kind.toUpperCase()} • {clip.lane}
                      </p>
                    </div>
                  </div>
                  <div className="clip-meta">
                    <span>{clip.bars} bars</span>
                    <span>{formatTime(clip.durationSeconds)}</span>
                    <span>{clip.sourceBpm} BPM</span>
                  </div>
                  {clip.kind === "audio" ? (
                    <div className="waveform-strip">
                      {clip.waveform.map((value, index) => (
                        <span key={`${clip.id}-${index}`} style={{ height: `${value * 48}px` }} />
                      ))}
                    </div>
                  ) : (
                    <div className="midi-strip">
                      {clip.midiPreview.map((note, index) => (
                        <span
                          key={`${clip.id}-${index}`}
                          style={{
                            left: `${(note.time / Math.max(clip.durationSeconds, 0.01)) * 100}%`,
                            top: `${100 - ((note.midi - 36) / 48) * 100}%`,
                            width: `${Math.max(2, (note.duration / Math.max(clip.durationSeconds, 0.01)) * 100)}%`,
                          }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </section>

        <section className="panel">
          <div className="section-head">
            <div>
              <p className="eyebrow">Inspector</p>
              <h2>Selected Loop</h2>
            </div>
          </div>

          {selectedClip ? (
            <div className="inspector-grid">
              <label>
                Name
                <input onChange={(event) => updateClip(selectedClip.id, { name: event.target.value })} value={selectedClip.name} />
              </label>
              <label>
                Lane
                <input onChange={(event) => updateClip(selectedClip.id, { lane: event.target.value })} value={selectedClip.lane} />
              </label>
              <label>
                Source BPM
                <input
                  min={50}
                  onChange={(event) => updateClip(selectedClip.id, { sourceBpm: clamp(Number(event.target.value), 50, 220) })}
                  type="number"
                  value={selectedClip.sourceBpm}
                />
              </label>
              <label>
                Start Bar
                <input
                  min={0}
                  onChange={(event) => updateClip(selectedClip.id, { startBar: Math.max(0, Number(event.target.value)) })}
                  type="number"
                  value={selectedClip.startBar}
                />
              </label>
              <label>
                Bars
                <input
                  min={1}
                  onChange={(event) => updateClip(selectedClip.id, { bars: Math.max(1, Number(event.target.value)) })}
                  type="number"
                  value={selectedClip.bars}
                />
              </label>
              <label>
                Volume
                <input
                  max={1}
                  min={0}
                  onChange={(event) => updateClip(selectedClip.id, { volume: Number(event.target.value) })}
                  step={0.01}
                  type="range"
                  value={selectedClip.volume}
                />
              </label>
              <label className="inline-toggle">
                <input checked={selectedClip.muted} onChange={(event) => updateClip(selectedClip.id, { muted: event.target.checked })} type="checkbox" />
                Mute clip
              </label>
              <button className="ghost-button danger" onClick={() => removeClip(selectedClip.id)} type="button">
                Remove clip
              </button>
            </div>
          ) : (
            <div className="empty-card">Select a loop to edit lane, clip BPM, start bar and gain.</div>
          )}
        </section>
      </aside>

      <main className="workspace">
        <header className="workspace-header panel">
          <div>
            <p className="eyebrow">Arrangement</p>
            <h2>Suno-style timeline for local loop composition</h2>
          </div>

          <div className="transport">
            <button className="transport-button" onClick={() => void (isPlaying ? stopPlayback() : startPlayback())} type="button">
              {isPlaying ? "Stop" : "Play"}
            </button>
            <div className="transport-readout">
              <span>{bpm} BPM</span>
              <span>{clips.length} clips</span>
              <span>{lanes.length} lanes</span>
            </div>
          </div>
        </header>

        <section className="timeline panel">
          <div className="timeline-topbar">
            <div>
              <p className="eyebrow">Transport status</p>
              <strong>{statusLine}</strong>
            </div>
            {errorLine ? <span className="error-pill">{errorLine}</span> : null}
          </div>

          <div className="bar-ruler" style={{ gridTemplateColumns: `200px repeat(${maxBars}, minmax(92px, 1fr))` }}>
            <div className="lane-label spacer" />
            {Array.from({ length: maxBars }, (_, index) => (
              <div className="bar-cell" key={`bar-${index + 1}`}>
                {index + 1}
              </div>
            ))}
          </div>

          <div className="timeline-grid">
            <div className="playhead" style={{ left: `calc(200px + ${(transportBar / visibleBars) * 100}%)` }} />

            {lanes.map((lane) => {
              const laneClips = clips.filter((clip) => clip.lane === lane);

              return (
                <div className="lane-row" key={lane} style={{ gridTemplateColumns: `200px repeat(${maxBars}, minmax(92px, 1fr))` }}>
                  <div className="lane-label">
                    <strong>{lane}</strong>
                    <span>{laneClips.length} clips</span>
                  </div>

                  {Array.from({ length: maxBars }, (_, index) => (
                    <div className="lane-cell" key={`${lane}-${index}`} />
                  ))}

                  {laneClips.map((clip) => (
                    <button
                      className={`timeline-clip ${selectedClip?.id === clip.id ? "selected" : ""}`}
                      key={clip.id}
                      onClick={() => setSelectedClipId(clip.id)}
                      style={{
                        background: `linear-gradient(135deg, ${clip.color}, color-mix(in srgb, ${clip.color} 58%, #ffebd2))`,
                        gridColumn: `${clip.startBar + 2} / span ${clip.bars}`,
                      }}
                      type="button"
                    >
                      <span>{clip.name}</span>
                      <small>
                        {clip.kind} • {clip.sourceBpm} BPM
                      </small>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
