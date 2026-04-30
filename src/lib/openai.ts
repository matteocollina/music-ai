import { invoke } from "@tauri-apps/api/core";
import { generatedMidiDataSchema } from "./midiGenerator";
import type { GeneratedMidiData, GenerationSettings } from "../types/music";

type GenerateMusicPayload = {
  apiKey: string;
  bpm: number;
  key: string;
  scale: string;
  bars: number;
  prompt: string;
};

export async function generateMusicData(settings: GenerationSettings): Promise<GeneratedMidiData> {
  const payload: GenerateMusicPayload = {
    apiKey: settings.apiKey.trim(),
    bpm: settings.bpm,
    key: settings.key,
    scale: settings.scale,
    bars: settings.bars,
    prompt: settings.prompt.trim(),
  };

  const response = await invoke<unknown>("generate_music_structure", { request: payload });
  const result = generatedMidiDataSchema.safeParse(response);

  if (!result.success) {
    throw new Error("La risposta OpenAI non contiene JSON valido nello schema richiesto.");
  }

  return result.data;
}
