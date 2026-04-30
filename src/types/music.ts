export type MusicalKey = "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";
export type MusicalScale = "major" | "minor" | "dorian" | "phrygian" | "lydian" | "mixolydian";
export type TrackName = "arpeggiator" | "chords" | "vocal" | "string";

export type MidiNote = {
  note: string;
  start: number;
  duration: number;
  velocity: number;
};

export type MidiChord = {
  notes: string[];
  start: number;
  duration: number;
  velocity: number;
};

export type GeneratedMidiData = {
  bpm: number;
  key: string;
  scale: string;
  tracks: {
    arpeggiator: MidiNote[];
    chords: MidiChord[];
    vocal: MidiNote[];
    string: MidiChord[];
  };
};

export type GenerationSettings = {
  apiKey: string;
  saveApiKey: boolean;
  bpm: number;
  key: MusicalKey;
  scale: MusicalScale;
  bars: number;
  prompt: string;
};
