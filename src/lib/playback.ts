import * as Tone from "tone";
import type { TrackEvent } from "./midiGenerator";
import type { GeneratedMidiData, PlaybackMode, TrackName } from "../types/music";

let activeSynths: Tone.PolySynth[] = [];
let activeTrackName: TrackName | null = null;
let activePlaybackMode: PlaybackMode | null = null;

function createSynth(trackName: TrackName) {
  return new Tone.PolySynth(Tone.Synth, {
    oscillator: {
      type: trackName === "arpeggiator" ? "sawtooth" : trackName === "vocal" ? "triangle" : "sine",
    },
    envelope: {
      attack: 0.01,
      decay: 0.15,
      sustain: 0.6,
      release: 0.8,
    },
  }).toDestination();
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
