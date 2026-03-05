"use client";
import { useState, useRef, useCallback } from "react";

interface Props {
  onTranscript: (text: string) => void;
  disabled?: boolean;
}

export default function VoiceButton({ onTranscript, disabled }: Props) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunks.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        setIsProcessing(true);

        try {
          const formData = new FormData();
          formData.append("file", blob, "recording.webm");
          const res = await fetch("/api/transcribe", {
            method: "POST",
            body: formData,
          });
          if (!res.ok) throw new Error("transcribe failed");
          const data = await res.json();
          if (data.text && data.text.trim()) {
            onTranscript(data.text);
          } else {
            throw new Error("empty transcript");
          }
        } catch {
          fallbackSpeechRecognition();
        } finally {
          setIsProcessing(false);
        }
      };

      mediaRecorder.current = recorder;
      recorder.start();
      setIsRecording(true);
    } catch {
      fallbackSpeechRecognition();
    }
  }, [onTranscript]);

  const stopRecording = useCallback(() => {
    if (mediaRecorder.current && isRecording) {
      mediaRecorder.current.stop();
      setIsRecording(false);
    }
  }, [isRecording]);

  const fallbackSpeechRecognition = () => {
    const SpeechRecognition =
      (window as unknown as Record<string, unknown>).SpeechRecognition ||
      (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new (SpeechRecognition as any)() as {
      lang: string;
      continuous: boolean;
      interimResults: boolean;
      onresult: (e: { results: SpeechRecognitionResultList }) => void;
      onerror: () => void;
      onend: () => void;
      start: () => void;
    };
    recognition.lang = "sk-SK";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e: { results: SpeechRecognitionResultList }) => {
      const text = e.results[0]?.[0]?.transcript;
      if (text) onTranscript(text);
      setIsRecording(false);
    };
    recognition.onerror = () => setIsRecording(false);
    recognition.onend = () => setIsRecording(false);
    recognition.start();
    setIsRecording(true);
  };

  return (
    <button
      onClick={isRecording ? stopRecording : startRecording}
      disabled={disabled || isProcessing}
      className={`p-2 rounded-xl transition-all ${
        isRecording
          ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
          : isProcessing
            ? "bg-zinc-700 text-zinc-400"
            : "hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200"
      }`}
      title={isRecording ? "Zastaviť nahrávanie" : "Hovoriť"}
    >
      {isProcessing ? (
        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" className="opacity-25" />
          <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4M12 15a3 3 0 003-3V5a3 3 0 00-6 0v7a3 3 0 003 3z"
          />
        </svg>
      )}
    </button>
  );
}
