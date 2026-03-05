"use client";
import { useState, useEffect, useCallback } from "react";

export interface ServiceHealth {
  id: string;
  name: string;
  status: "online" | "offline" | "checking";
  latency?: number;
  details?: string;
}

const POLL_INTERVAL = 30_000;

export function useHealth() {
  const [services, setServices] = useState<ServiceHealth[]>([
    { id: "ollama", name: "Ollama (LLM)", status: "checking" },
    { id: "knowledge_api", name: "Knowledge API", status: "checking" },
    { id: "gemini", name: "Google Gemini", status: "checking" },
  ]);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const data = await res.json();
        setServices(data.services);
      }
    } catch {
      // keep current state
    }
  }, []);

  useEffect(() => {
    check();
    const interval = setInterval(check, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [check]);

  const getStatus = useCallback(
    (id: string): ServiceHealth | undefined => services.find((s) => s.id === id),
    [services]
  );

  const isOnline = useCallback(
    (id: string): boolean => getStatus(id)?.status === "online",
    [getStatus]
  );

  return { services, check, getStatus, isOnline };
}
