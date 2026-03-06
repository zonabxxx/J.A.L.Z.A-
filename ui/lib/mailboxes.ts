"use client";
import { useState, useEffect } from "react";

export interface Mailbox {
  id: string;
  label: string;
  email: string;
  type: string;
  icon: string;
}

const FALLBACK_MAILBOXES: Mailbox[] = [
  { id: "personal", label: "Osobná", email: "j.martinkovych@gmail.com", type: "imap", icon: "📧" },
  { id: "adsun", label: "Adsun", email: "info@adsun.sk", type: "msgraph", icon: "🏢" },
  { id: "juraj", label: "Juraj", email: "juraj@adsun.sk", type: "msgraph", icon: "👤" },
];

let cachedMailboxes: Mailbox[] | null = null;

export async function fetchMailboxes(): Promise<Mailbox[]> {
  if (cachedMailboxes) return cachedMailboxes;
  try {
    const res = await fetch("/api/mailboxes");
    if (res.ok) {
      const data = await res.json();
      if (data.mailboxes?.length) {
        cachedMailboxes = data.mailboxes;
        return cachedMailboxes;
      }
    }
  } catch {
    // fallback
  }
  return FALLBACK_MAILBOXES;
}

export function buildMailboxPromptContext(mailboxes: Mailbox[]): string {
  return mailboxes
    .map(mb => `- "${mb.id}" = ${mb.label} (${mb.email})`)
    .join("\n");
}

export function detectMailboxByEmail(text: string, mailboxes: Mailbox[]): string | null {
  const lower = text.toLowerCase();
  for (const mb of mailboxes) {
    if (lower.includes(mb.email.toLowerCase())) return mb.id;
  }
  return null;
}

export function useMailboxes() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>(FALLBACK_MAILBOXES);

  useEffect(() => {
    fetchMailboxes().then(setMailboxes);
  }, []);

  return mailboxes;
}
