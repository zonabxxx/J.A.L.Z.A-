"use client";
import { useState, useRef } from "react";

interface Props {
  text: string;
}

export default function SpeakButton({ text }: Props) {
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const handleSpeak = async () => {
    if (playing && audioRef.current) {
      audioRef.current.pause();
      setPlaying(false);
      return;
    }

    setPlaying(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) {
        // Fallback: browser TTS
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = "sk-SK";
        utterance.onend = () => setPlaying(false);
        speechSynthesis.speak(utterance);
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
      };
      audio.play();
    } catch {
      // Fallback: browser TTS
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "sk-SK";
      utterance.onend = () => setPlaying(false);
      speechSynthesis.speak(utterance);
    }
  };

  if (!text) return null;

  return (
    <button
      onClick={handleSpeak}
      className={`p-1 rounded transition-colors ${
        playing
          ? "text-blue-400 hover:text-blue-300"
          : "text-zinc-600 hover:text-zinc-400"
      }`}
      title={playing ? "Zastaviť" : "Prehrať"}
    >
      {playing ? (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
        </svg>
      ) : (
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728M11 5L6 9H2v6h4l5 4V5z"
          />
        </svg>
      )}
    </button>
  );
}
