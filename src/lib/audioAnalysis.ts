import type {
  ExtractedChordSegment,
  MusicalKey,
  ReferenceAnalysis,
  StructureSection,
} from "../types/music";

const TARGET_SAMPLE_RATE = 11_025;
const WINDOW_SIZE = 2_048;
const HOP_SIZE = 1_024;
const ENERGY_WINDOW = 1_024;
const ENERGY_HOP = 512;
const HANN_WINDOW = buildHannWindow(WINDOW_SIZE);
const NOTE_NAMES: MusicalKey[] = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const CHORD_PATTERNS = [
  { suffix: "", intervals: [0, 4, 7], weights: [1, 0.92, 0.86] },
  { suffix: "m", intervals: [0, 3, 7], weights: [1, 0.94, 0.86] },
  { suffix: "maj7", intervals: [0, 4, 7, 11], weights: [1, 0.9, 0.82, 0.76] },
  { suffix: "m7", intervals: [0, 3, 7, 10], weights: [1, 0.92, 0.84, 0.76] },
  { suffix: "7", intervals: [0, 4, 7, 10], weights: [1, 0.88, 0.82, 0.72] },
  { suffix: "sus2", intervals: [0, 2, 7], weights: [1, 0.74, 0.82] },
  { suffix: "sus4", intervals: [0, 5, 7], weights: [1, 0.74, 0.82] },
  { suffix: "dim", intervals: [0, 3, 6], weights: [1, 0.86, 0.66] },
] as const;
const ANALYSIS_FREQUENCIES = Array.from({ length: 36 }, (_, index) => 65.4064 * 2 ** (index / 12));

type KeyEstimate = {
  key: MusicalKey;
  scale: "major" | "minor";
};

type ChordCandidate = {
  symbol: string;
  notes: string[];
  confidence: number;
};

export async function analyzeReferenceAudio(file: File): Promise<ReferenceAnalysis> {
  const arrayBuffer = await file.arrayBuffer();
  const AudioContextCtor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error("Il browser embedded non supporta Web Audio per l'analisi del file.");
  }

  const decodeContext = new AudioContextCtor();

  try {
    const decoded = await decodeContext.decodeAudioData(arrayBuffer.slice(0));
    const resampled = await resampleBuffer(decoded, TARGET_SAMPLE_RATE);
    const mono = mixToMono(resampled);

    if (mono.length < WINDOW_SIZE * 2) {
      throw new Error("Il file audio e troppo corto per estrarre una progressione armonica affidabile.");
    }

    const bpm = estimateTempo(mono, TARGET_SAMPLE_RATE);
    const chromaFrames = computeChromaFrames(mono, TARGET_SAMPLE_RATE);

    if (chromaFrames.length < 4) {
      throw new Error("Analisi armonica insufficiente: impossibile stimare gli accordi.");
    }

    const globalChroma = averageChroma(chromaFrames.map((frame) => frame.chroma));
    const keyEstimate = estimateKey(globalChroma);
    const secondsPerBeat = 60 / bpm;
    const estimatedBars = clampBars(Math.max(1, Math.round(decoded.duration / (secondsPerBeat * 4))));
    const chordTimeline = buildChordTimeline(chromaFrames, secondsPerBeat, estimatedBars, keyEstimate);

    if (chordTimeline.length === 0) {
      throw new Error("Estrazione accordi fallita: nessuna progressione utilizzabile trovata.");
    }

    const confidence = chordTimeline.reduce((sum, chord) => sum + chord.confidence, 0) / chordTimeline.length;

    return {
      sourceFileName: file.name,
      bpm: Math.round(bpm),
      key: keyEstimate.key,
      scale: keyEstimate.scale,
      duration: roundTo(decoded.duration, 2),
      estimatedBars,
      confidence: roundTo(confidence, 3),
      confidenceLabel: confidence >= 0.72 ? "high" : confidence >= 0.52 ? "medium" : "low",
      chordTimeline,
      structure: buildStructureSections(chordTimeline),
    };
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Impossibile analizzare il file audio selezionato.");
  } finally {
    await decodeContext.close();
  }
}

async function resampleBuffer(audioBuffer: AudioBuffer, sampleRate: number) {
  if (audioBuffer.sampleRate === sampleRate) {
    return audioBuffer;
  }

  const frameCount = Math.ceil(audioBuffer.duration * sampleRate);
  const offlineContext = new OfflineAudioContext(1, frameCount, sampleRate);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);
  return offlineContext.startRendering();
}

function mixToMono(audioBuffer: AudioBuffer) {
  const mono = new Float32Array(audioBuffer.length);

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const input = audioBuffer.getChannelData(channel);
    for (let index = 0; index < input.length; index += 1) {
      mono[index] += input[index] / audioBuffer.numberOfChannels;
    }
  }

  return mono;
}

function estimateTempo(samples: Float32Array, sampleRate: number) {
  const envelope: number[] = [];

  for (let start = 0; start + ENERGY_WINDOW <= samples.length; start += ENERGY_HOP) {
    let energy = 0;
    for (let i = 0; i < ENERGY_WINDOW; i += 1) {
      const sample = samples[start + i];
      energy += sample * sample;
    }
    envelope.push(Math.sqrt(energy / ENERGY_WINDOW));
  }

  const flux = envelope.map((value, index) => (index === 0 ? 0 : Math.max(0, value - envelope[index - 1])));
  const frameRate = sampleRate / ENERGY_HOP;
  const minLag = Math.round(frameRate * 60 / 180);
  const maxLag = Math.round(frameRate * 60 / 70);
  let bestLag = minLag;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let i = lag; i < flux.length; i += 1) {
      score += flux[i] * flux[i - lag];
    }

    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  let bpm = (60 * frameRate) / bestLag;

  while (bpm < 90) {
    bpm *= 2;
  }
  while (bpm > 180) {
    bpm /= 2;
  }

  return bpm;
}

function computeChromaFrames(samples: Float32Array, sampleRate: number) {
  const frames: Array<{ time: number; chroma: number[] }> = [];

  for (let start = 0; start + WINDOW_SIZE <= samples.length; start += HOP_SIZE) {
    const window = samples.subarray(start, start + WINDOW_SIZE);
    const chroma = computeFrameChroma(window, sampleRate);
    frames.push({
      time: start / sampleRate,
      chroma,
    });
  }

  return frames;
}

function computeFrameChroma(window: Float32Array, sampleRate: number) {
  const chroma = new Array<number>(12).fill(0);

  ANALYSIS_FREQUENCIES.forEach((frequency, index) => {
    const power = goertzelPower(window, sampleRate, frequency, HANN_WINDOW);
    chroma[index % 12] += power;
  });

  const total = chroma.reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    return chroma;
  }

  return chroma.map((value) => value / total);
}

function buildHannWindow(length: number) {
  const values = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    values[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / (length - 1)));
  }
  return values;
}

function goertzelPower(samples: Float32Array, sampleRate: number, frequency: number, window: Float32Array) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const coeff = 2 * Math.cos(omega);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;

  for (let i = 0; i < samples.length; i += 1) {
    s0 = samples[i] * window[i] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }

  return s1 * s1 + s2 * s2 - coeff * s1 * s2;
}

function averageChroma(chromaFrames: number[][]) {
  const total = new Array<number>(12).fill(0);

  chromaFrames.forEach((frame) => {
    frame.forEach((value, index) => {
      total[index] += value;
    });
  });

  const sum = total.reduce((acc, value) => acc + value, 0) || 1;
  return total.map((value) => value / sum);
}

function estimateKey(chroma: number[]): KeyEstimate {
  let bestKey: KeyEstimate = { key: "C", scale: "minor" };
  let bestScore = Number.NEGATIVE_INFINITY;

  NOTE_NAMES.forEach((key, rootIndex) => {
    const majorScore = correlateRotated(chroma, MAJOR_PROFILE, rootIndex);
    if (majorScore > bestScore) {
      bestScore = majorScore;
      bestKey = { key, scale: "major" };
    }

    const minorScore = correlateRotated(chroma, MINOR_PROFILE, rootIndex);
    if (minorScore > bestScore) {
      bestScore = minorScore;
      bestKey = { key, scale: "minor" };
    }
  });

  return bestKey;
}

function correlateRotated(chroma: number[], profile: number[], rotation: number) {
  let score = 0;
  for (let index = 0; index < 12; index += 1) {
    score += chroma[index] * profile[(index - rotation + 12) % 12];
  }
  return score;
}

function buildChordTimeline(
  chromaFrames: Array<{ time: number; chroma: number[] }>,
  secondsPerBeat: number,
  estimatedBars: number,
  keyEstimate: KeyEstimate,
) {
  const secondsPerBar = secondsPerBeat * 4;
  const timeline: ExtractedChordSegment[] = [];

  for (let bar = 0; bar < estimatedBars; bar += 1) {
    const startTime = bar * secondsPerBar;
    const endTime = startTime + secondsPerBar;
    const frames = chromaFrames.filter((frame) => frame.time >= startTime && frame.time < endTime);

    if (frames.length === 0) {
      continue;
    }

    const chroma = averageChroma(frames.map((frame) => frame.chroma));
    const bestChord = detectChord(chroma, keyEstimate);

    timeline.push({
      chord: bestChord.symbol,
      startTime: roundTo(startTime, 3),
      endTime: roundTo(endTime, 3),
      confidence: roundTo(bestChord.confidence, 3),
      notes: bestChord.notes,
      bar: bar + 1,
    });
  }

  return timeline;
}

function detectChord(chroma: number[], keyEstimate: KeyEstimate): ChordCandidate {
  const ranked = CHORD_PATTERNS.flatMap((pattern) =>
    NOTE_NAMES.map((root, rootIndex) => {
      const hits = pattern.intervals.map((interval, intervalIndex) => {
        const pitchClass = (rootIndex + interval) % 12;
        return chroma[pitchClass] * pattern.weights[intervalIndex];
      });
      const inChord = hits.reduce((sum, value) => sum + value, 0) / pattern.weights.length;
      const chordEnergy = pattern.intervals.reduce<number>((sum, interval) => sum + chroma[(rootIndex + interval) % 12], 0);
      const outsideChord = chroma.reduce((sum, value) => sum + value, 0) - chordEnergy;
      const tonalBias =
        root === keyEstimate.key ? 0.06 : pattern.suffix.startsWith("m") && keyEstimate.scale === "minor" ? 0.03 : 0;
      const score = inChord - outsideChord * 0.35 + tonalBias;

      return {
        symbol: `${root}${pattern.suffix}`,
        notes: pattern.intervals.map((interval, noteIndex) => toChordNote(rootIndex, interval, noteIndex)),
        score,
      };
    }),
  ).sort((left, right) => right.score - left.score);

  const [best, second] = ranked;
  const spread = Math.max(0.05, best.score - (second?.score ?? 0));
  const confidence = Math.max(0, Math.min(1, best.score * 1.1 + spread * 1.7));

  return {
    symbol: best.symbol,
    notes: best.notes,
    confidence,
  };
}

function toChordNote(rootIndex: number, interval: number, noteIndex: number) {
  const pitchClass = NOTE_NAMES[(rootIndex + interval) % 12];
  const octave = noteIndex === 0 ? 3 : 4;
  return `${pitchClass}${octave}`;
}

function buildStructureSections(chordTimeline: ExtractedChordSegment[]) {
  if (chordTimeline.length === 0) {
    return [];
  }

  const sections: StructureSection[] = [];
  let currentStart = 0;

  for (let index = 1; index < chordTimeline.length; index += 1) {
    const current = chordTimeline[index];
    const shouldSplit = index - currentStart >= 4 && current.chord === chordTimeline[currentStart].chord;

    if (shouldSplit) {
      sections.push(createSection(sections.length + 1, chordTimeline, currentStart, index - 1));
      currentStart = index;
    }

    if (index === chordTimeline.length - 1) {
      sections.push(createSection(sections.length + 1, chordTimeline, currentStart, index));
    }
  }

  if (sections.length === 0) {
    sections.push(createSection(1, chordTimeline, 0, chordTimeline.length - 1));
  }

  return sections;
}

function createSection(labelIndex: number, timeline: ExtractedChordSegment[], startIndex: number, endIndex: number) {
  return {
    label: `Section ${labelIndex}`,
    startTime: timeline[startIndex].startTime,
    endTime: timeline[endIndex].endTime,
    startBar: timeline[startIndex].bar,
    endBar: timeline[endIndex].bar,
  };
}

function clampBars(value: number) {
  return Math.max(1, Math.min(32, value));
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
