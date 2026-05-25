import * as Tone from "tone";
import type { TrackEvent } from "./midiGenerator";
import type { GeneratedMidiData, PlaybackMode, TrackName } from "../types/music";

type PlaybackInstrument = {
  dispose: () => void;
  releaseAll: () => void;
  triggerAttackRelease: (notes: string[], duration: number, time: number, velocity: number) => void;
};

let activeSynths: PlaybackInstrument[] = [];
let activeTrackName: TrackName | null = null;
let activePlaybackMode: PlaybackMode | null = null;

function createSynth(trackName: TrackName) {
  const output = new Tone.Volume(-8).toDestination();
  const disposeNodes: Tone.ToneAudioNode[] = [output];

  if (trackName === "arpeggiator") {
    const delay = new Tone.PingPongDelay("16n", 0.18);
    const filter = new Tone.Filter(2400, "lowpass");
    const synth = new Tone.PolySynth(Tone.FMSynth, {
      harmonicity: 3,
      modulationIndex: 8,
      oscillator: { type: "triangle" },
      envelope: {
        attack: 0.005,
        decay: 0.08,
        sustain: 0.14,
        release: 0.16,
      },
      modulation: { type: "square" },
      modulationEnvelope: {
        attack: 0.01,
        decay: 0.12,
        sustain: 0.1,
        release: 0.14,
      },
    });

    synth.chain(filter, delay, output);
    disposeNodes.push(synth, filter, delay);
    return createPlaybackInstrument(synth, disposeNodes);
  }

  if (trackName === "chords") {
    const chorus = new Tone.Chorus(0.8, 2.4, 0.3).start();
    const reverb = new Tone.Reverb({ decay: 3.8, wet: 0.32, preDelay: 0.03 });
    const filter = new Tone.Filter(1450, "lowpass");
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: "fatsawtooth", count: 3, spread: 22 },
      envelope: {
        attack: 0.08,
        decay: 0.35,
        sustain: 0.72,
        release: 1.8,
      },
    });

    synth.chain(filter, chorus, reverb, output);
    disposeNodes.push(synth, filter, chorus, reverb);
    return createPlaybackInstrument(synth, disposeNodes);
  }

  if (trackName === "vocal") {
    const vibrato = new Tone.Vibrato(4.5, 0.12);
    const reverb = new Tone.Reverb({ decay: 4.2, wet: 0.36, preDelay: 0.05 });
    const synth = new Tone.PolySynth(Tone.AMSynth, {
      harmonicity: 1.8,
      oscillator: { type: "triangle" },
      envelope: {
        attack: 0.03,
        decay: 0.18,
        sustain: 0.58,
        release: 1.2,
      },
      modulation: { type: "sine" },
      modulationEnvelope: {
        attack: 0.04,
        decay: 0.2,
        sustain: 0.38,
        release: 0.6,
      },
    });

    synth.chain(vibrato, reverb, output);
    disposeNodes.push(synth, vibrato, reverb);
    return createPlaybackInstrument(synth, disposeNodes);
  }

  const reverb = new Tone.Reverb({ decay: 5.5, wet: 0.28, preDelay: 0.02 });
  const filter = new Tone.Filter(1800, "lowpass");
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "sawtooth" },
    envelope: {
      attack: 0.18,
      decay: 0.28,
      sustain: 0.88,
      release: 2.6,
    },
  });

  synth.chain(filter, reverb, output);
  disposeNodes.push(synth, filter, reverb);
  return createPlaybackInstrument(synth, disposeNodes);
}

function createPlaybackInstrument(synth: Tone.PolySynth, nodes: Tone.ToneAudioNode[]): PlaybackInstrument {
  return {
    dispose() {
      nodes.forEach((node) => node.dispose());
    },
    releaseAll() {
      synth.releaseAll();
    },
    triggerAttackRelease(notes, duration, time, velocity) {
      synth.triggerAttackRelease(notes, duration, time, velocity);
    },
  };
}

export async function playTrack(trackName: TrackName, events: TrackEvent[], bpm: number) {
  await Tone.start();
  stopPlayback();

  Tone.Transport.cancel();
  Tone.Transport.stop();
  Tone.Transport.position = 0;
  Tone.Transport.bpm.value = bpm;

  const synth = createSynth(trackName);
  activeSynths = [synth];

  const secondsPerBeat = 60 / bpm;

  events.forEach((event) => {
    const notes = "note" in event ? [event.note] : event.notes;
    Tone.Transport.schedule((time) => {
      synth.triggerAttackRelease(notes, event.duration * secondsPerBeat, time, event.velocity / 127);
    }, event.start * secondsPerBeat);
  });

  const endBeat = Math.max(...events.map((event) => event.start + event.duration), 0);
  Tone.Transport.scheduleOnce(() => {
    stopPlayback();
  }, endBeat * secondsPerBeat + 0.05);

  activeTrackName = trackName;
  activePlaybackMode = "single";
  Tone.Transport.start();
  return endBeat * secondsPerBeat * 1000;
}

export async function playAllTracks(data: GeneratedMidiData) {
  await Tone.start();
  stopPlayback();

  Tone.Transport.cancel();
  Tone.Transport.stop();
  Tone.Transport.position = 0;
  Tone.Transport.bpm.value = data.bpm;

  const tracks: Array<{ trackName: TrackName; events: TrackEvent[] }> = [
    { trackName: "arpeggiator", events: data.tracks.arpeggiator },
    { trackName: "chords", events: data.tracks.chords },
    { trackName: "vocal", events: data.tracks.vocal },
    { trackName: "string", events: data.tracks.string },
  ];

  const secondsPerBeat = 60 / data.bpm;
  let endBeat = 0;

  activeSynths = tracks.map(({ trackName, events }) => {
    const synth = createSynth(trackName);

    events.forEach((event) => {
      const notes = "note" in event ? [event.note] : event.notes;
      endBeat = Math.max(endBeat, event.start + event.duration);

      Tone.Transport.schedule((time) => {
        synth.triggerAttackRelease(notes, event.duration * secondsPerBeat, time, event.velocity / 127);
      }, event.start * secondsPerBeat);
    });

    return synth;
  });

  Tone.Transport.scheduleOnce(() => {
    stopPlayback();
  }, endBeat * secondsPerBeat + 0.05);

  activeTrackName = null;
  activePlaybackMode = "all";
  Tone.Transport.start();
  return endBeat * secondsPerBeat * 1000;
}

export function stopPlayback() {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  activeSynths.forEach((synth) => {
    synth.releaseAll();
    synth.dispose();
  });
  activeSynths = [];
  activeTrackName = null;
  activePlaybackMode = null;
}

export function getActiveTrackName() {
  return activeTrackName;
}

export function getPlaybackMode() {
  return activePlaybackMode;
}
