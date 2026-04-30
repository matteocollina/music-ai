import * as Tone from "tone";
import type { TrackEvent } from "./midiGenerator";
import type { TrackName } from "../types/music";

let activeSynth: Tone.PolySynth | null = null;
let activeTrackName: TrackName | null = null;

export async function playTrack(trackName: TrackName, events: TrackEvent[], bpm: number) {
  await Tone.start();
  stopPlayback();

  Tone.Transport.cancel();
  Tone.Transport.stop();
  Tone.Transport.position = 0;
  Tone.Transport.bpm.value = bpm;

  activeSynth = new Tone.PolySynth(Tone.Synth, {
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

  const secondsPerBeat = 60 / bpm;

  events.forEach((event) => {
    const notes = "note" in event ? [event.note] : event.notes;
    Tone.Transport.schedule((time) => {
      activeSynth?.triggerAttackRelease(
        notes,
        event.duration * secondsPerBeat,
        time,
        event.velocity / 127,
      );
    }, event.start * secondsPerBeat);
  });

  const endBeat = Math.max(...events.map((event) => event.start + event.duration), 0);
  Tone.Transport.scheduleOnce(() => {
    stopPlayback();
  }, endBeat * secondsPerBeat + 0.05);

  activeTrackName = trackName;
  Tone.Transport.start();
  return endBeat * secondsPerBeat * 1000;
}

export function stopPlayback() {
  Tone.Transport.stop();
  Tone.Transport.cancel();
  activeSynth?.releaseAll();
  activeSynth?.dispose();
  activeSynth = null;
  activeTrackName = null;
}

export function getActiveTrackName() {
  return activeTrackName;
}
