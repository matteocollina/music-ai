# Music AI

Desktop app Tauri per generare quattro tracce MIDI separate da un prompt testuale, con variazioni creative ad ogni rigenerazione:

- `arpeggiator`
- `chords`
- `vocal`
- `string`

## Stack

- Tauri 2
- React 19 + TypeScript + Vite
- Backend Rust per chiamare OpenAI
- Tone.js per playback
- `@tonejs/midi` per export `.mid`

## Funzioni

- form con API key, BPM, tonalita, scala, creativita e numero di battute
- salvataggio locale impostazioni MVP via `localStorage`
- validazione JSON della risposta OpenAI
- token di variazione automatico per evitare output troppo identici con lo stesso prompt
- playback singolo per traccia
- download separato dei file MIDI

## Prerequisiti

- Node.js `20.19+` oppure `22.12+`
- Rust toolchain installata tramite `rustup`
- Tauri prerequisites per macOS

## Avvio

```bash
npm install
npm run tauri dev
```

## Note

- La OpenAI API key non e hardcodata.
- La key viene inserita dall'utente e non viene loggata in console.
- In questo MVP il salvataggio persistente usa `localStorage`.
