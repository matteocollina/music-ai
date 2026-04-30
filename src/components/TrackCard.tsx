import { useEffect, useRef } from "react";
import { downloadTrackMidi, formatTrackEvents, type TrackEvent } from "../lib/midiGenerator";
import { playTrack, stopPlayback } from "../lib/playback";
import type { TrackName } from "../types/music";

type TrackCardProps = {
  trackName: TrackName;
  events: TrackEvent[];
  bpm: number;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
};

export function TrackCard({ trackName, events, bpm, isPlaying, onPlay, onStop }: TrackCardProps) {
  const stopTimeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (stopTimeoutRef.current) {
        window.clearTimeout(stopTimeoutRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!isPlaying && stopTimeoutRef.current) {
      window.clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
  }, [isPlaying]);

  async function handlePlay() {
    if (stopTimeoutRef.current) {
      window.clearTimeout(stopTimeoutRef.current);
    }

    const durationMs = await playTrack(trackName, events, bpm);
    onPlay();

    stopTimeoutRef.current = window.setTimeout(() => {
      stopTimeoutRef.current = null;
      onStop();
    }, durationMs + 150);
  }

  function handleStop() {
    if (stopTimeoutRef.current) {
      window.clearTimeout(stopTimeoutRef.current);
    }

    stopPlayback();
    onStop();
  }

  function handleDownload() {
    downloadTrackMidi(trackName, events, bpm);
  }

  return (
    <article className="track-card">
      <div className="track-card-header">
        <div>
          <span className="track-label">Track</span>
          <h3>{trackName}</h3>
        </div>
        <span className={`play-indicator ${isPlaying ? "playing" : ""}`}>{isPlaying ? "Playing" : "Ready"}</span>
      </div>

      <div className="track-actions">
        <button type="button" onClick={handlePlay}>
          Play
        </button>
        <button type="button" onClick={handleStop}>
          Stop
        </button>
        <button type="button" onClick={handleDownload}>
          Download .mid
        </button>
      </div>

      <ul className="note-list">
        {formatTrackEvents(events).map((entry, index) => (
          <li key={`${trackName}-${index}`}>{entry}</li>
        ))}
      </ul>
    </article>
  );
}
