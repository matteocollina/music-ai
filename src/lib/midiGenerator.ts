import { Midi } from "@tonejs/midi";
import { z } from "zod";
import type { GeneratedMidiData, MidiChord, MidiNote, TrackName } from "../types/music";

const notePattern = /^[A-G](#|b)?[0-8]$/;

export const midiNoteSchema = z.object({
  note: z.string().regex(notePattern),
  start: z.number().min(0),
  duration: z.number().positive(),
  velocity: z.number().int().min(1).max(127),
});

export const midiChordSchema = z.object({
  notes: z.array(z.string().regex(notePattern)).min(1),
  start: z.number().min(0),
  duration: z.number().positive(),
  velocity: z.number().int().min(1).max(127),
});

export const generatedMidiDataSchema = z.object({
  bpm: z.number().min(40).max(240),
  key: z.string().min(1),
  scale: z.string().min(1),
  tracks: z.object({
    arpeggiator: z.array(midiNoteSchema),
    chords: z.array(midiChordSchema),
    vocal: z.array(midiNoteSchema),
    string: z.array(midiChordSchema),
  }),
}) satisfies z.ZodType<GeneratedMidiData>;

export type TrackEvent = MidiNote | MidiChord;

export function formatTrackEvents(events: TrackEvent[]): string[] {
  return events.map((event) => {
    if ("note" in event) {
      return `${event.note} ${formatDuration(event.duration)}`;
    }

    return `${event.notes.join(" · ")} ${formatDuration(event.duration)}`;
  });
}

export function downloadTrackMidi(trackName: TrackName, events: TrackEvent[], bpm: number) {
  const midi = new Midi();
  midi.header.setTempo(bpm);
  const track = midi.addTrack();

  events.forEach((event) => {
    if ("note" in event) {
      track.addNote({
        name: event.note,
        time: event.start,
        duration: event.duration,
        velocity: event.velocity / 127,
      });
      return;
    }

    event.notes.forEach((note) => {
      track.addNote({
        name: note,
        time: event.start,
        duration: event.duration,
        velocity: event.velocity / 127,
      });
    });
  });

  const blob = new Blob([midi.toArray()], { type: "audio/midi" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${trackName}.mid`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDuration(duration: number) {
  const mapping = new Map<number, string>([
    [0.25, "1/16"],
    [0.5, "1/8"],
    [1, "1/4"],
    [2, "1/2"],
    [4, "1 bar"],
    [8, "2 bars"],
  ]);

  return mapping.get(duration) ?? `${duration} beat`;
}
