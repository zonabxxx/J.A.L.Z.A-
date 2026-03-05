"use client";
import { useState, useRef, useCallback, useEffect } from "react";

interface Props {
  onTranscript: (text: string) => void;
  onInterim?: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceButton({ onTranscript, onInterim, disabled }: Props) {
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<ReturnType<typeof createRecognition> | null>(null);
  const finalTextRef = useRef("");

  const createRecognition = useCallback(() => {
    const SR =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SR) return null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec = new (SR as any)() as {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      maxAlternatives: number;
      onresult: (e: { results: SpeechRecognitionResultList; resultIndex: number }) => void;
      onerror: (e: { error: string }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
      abort: () => void;
    };

    rec.lang = "sk-SK";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    return rec;
  }, []);

  const stop = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const start = useCallback(() => {
    const rec = createRecognition();
    if (!rec) return;

    finalTextRef.current = "";
    recognitionRef.current = rec;

    rec.onresult = (e) => {
      let interim = "";
      let final = "";

      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        const text = result[0]?.transcript || "";
        if (result.isFinal) {
          final += text + " ";
        } else {
          interim += text;
        }
      }

      finalTextRef.current = final.trim();
      const combined = (final + interim).trim();

      if (onInterim && combined) {
        onInterim(combined);
      }
    };

    rec.onerror = (e) => {
      if (e.error !== "aborted" && e.error !== "no-speech") {
        console.warn("Speech recognition error:", e.error);
      }
      setIsListening(false);
    };

    rec.onend = () => {
      setIsListening(false);
      const text = finalTextRef.current.trim();
      if (text) {
        onTranscript(text);
      }
      if (onInterim) onInterim("");
    };

    try {
      rec.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  }, [createRecognition, onTranscript, onInterim]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort();
      }
    };
  }, []);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  return (
    <button
      onClick={toggle}
      disabled={disabled}
      className={`p-2 rounded-xl transition-all ${
        isListening
          ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
          : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
      }`}
      title={isListening ? "Zastaviť" : "Hovoriť"}
    >
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"
        />
      </svg>
    </button>
  );
}
