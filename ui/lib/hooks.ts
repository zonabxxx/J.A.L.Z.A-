"use client";
import { useState, useCallback, useRef, useEffect } from "react";
import type { Message, Agent } from "./types";
import { detectRoute, type RouteResult } from "./router";
import { getLocation } from "./location";
import {
  saveConversation,
  getConversation,
  type StoredMessage,
} from "./chat-storage";
import { parseEmailCommand, getContacts } from "./email-parser";
import { AVAILABLE_MODELS, type ModelOption } from "./config";
import { trackUsage } from "./usage-tracker";

const GEMINI_EMAIL_SYSTEM = `Si emailový asistent J.A.L.Z.A. Dostaneš text od používateľa — často zo speech-to-text, skomolený, s preklepmi a výplňovými slovami.

TVOJA ÚLOHA: Pochop ZÁMER a odpovedz v JSON.

KROK 1 — Rozpoznaj zámer (intent):
- "send" = chce POSLAŤ / napísať / odoslať email (akýkoľvek tvar: poslať, posli, napíš, odošli, chcem poslat mail...)
- "list" = chce VIDIEŤ / skontrolovať / prečítať svoje emaily
- "search" = chce HĽADAŤ konkrétny email
- "cleanup" = chce VYMAZAŤ spam / staré / marketing emaily
- "read" = chce PREČÍTAŤ konkrétny email (číslo)
- "reply" = chce ODPOVEDAŤ na email
- "unknown" = nejasné

KROK 2 — Pre "send" extrahuj:
- subject: len PODSTATA predmetu (nie "predmet mailu je test" → len "Test")
- body: len OBSAH emailu napísaný ako normálny email s pozdravom a podpisom "Juraj"
- Ignoruj inštrukčné slová: "mailu je", "cez telo", "na predmet", "s tým že"

ODPOVEDZ IBA JSON:
- Send: {"intent":"send","subject":"Test","body":"Ahoj,\\ntoto je test.\\nS pozdravom,\\nJuraj"}
- List: {"intent":"list","today":true}
- Search: {"intent":"search","query":"faktúra"}
- Cleanup: {"intent":"cleanup"}
- Read: {"intent":"read","number":3}
- Reply: {"intent":"reply","number":1}
- Unknown: {"intent":"unknown"}

PRÍKLADY:
- "chcem poslať testovací mail predmet test telo testujem" → {"intent":"send","subject":"Test","body":"Ahoj,\\ntestujem.\\nS pozdravom,\\nJuraj"}
- "aké maily mi dnes prišli" → {"intent":"list","today":true}
- "hľadaj mail od Juraja o faktúre" → {"intent":"search","query":"Juraj faktúra"}
- "prečítaj mail číslo 3" → {"intent":"read","number":3}
- "vymaž spam" → {"intent":"cleanup"}
- "napíš mail na adresu juraj @ adresu sk predmet test telo ahoj" → {"intent":"send","subject":"Test","body":"Ahoj,\\n\\nahoj.\\n\\nS pozdravom,\\nJuraj"}`;

export interface EmailData {
  from: string;
  subject: string;
  date: string;
  snippet?: string;
  id?: string;
  unread?: boolean;
}

export interface CalendarEventData {
  id: string;
  subject: string;
  start: string;
  end: string;
  is_all_day: boolean;
  location: string;
  organizer: string;
  organizer_email: string;
  attendees?: { name: string; email: string; status: string }[];
  preview?: string;
  body?: string;
  web_link?: string;
}

export interface ChatMessage extends Message {
  route?: RouteResult;
  emails?: EmailData[];
  mailbox?: string;
  generatedImage?: string;
  calendarEvents?: CalendarEventData[];
}

export function useChat(activeAgent: Agent | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteResult | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(AVAILABLE_MODELS[0]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const pendingEmailRef = useRef<{
    to: string;
    subject: string;
    body: string;
    mailbox: string;
  } | null>(null);

  const draftEmailRef = useRef<{
    originalText: string;
    subject: string | null;
    body: string | null;
    mailbox: string;
    missing: string[];
  } | null>(null);

  const debouncedSave = useCallback(
    (msgs: ChatMessage[], convId: string | null) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(async () => {
        if (msgs.length === 0) return;
        const stored: StoredMessage[] = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          route: m.route,
        }));
        const id = await saveConversation(
          convId,
          stored,
          activeAgent?.key || null,
          activeAgent?.name || null
        );
        setConversationId(id);
      }, 500);
    },
    [activeAgent]
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  const streamResponse = async (
    url: string,
    body: Record<string, unknown>,
    route: RouteResult,
    updatedMessages: ChatMessage[],
    convId: string | null
  ) => {
    const assistantMsg: ChatMessage = { role: "assistant", content: "", route };
    setMessages([...updatedMessages, assistantMsg]);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok || !res.body) throw new Error("Request failed");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = "";
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const payload = line.slice(6);
          if (payload === "[DONE]") continue;
          try {
            const data = JSON.parse(payload);
            if (data.content) {
              fullContent += data.content;
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = {
                  role: "assistant",
                  content: fullContent,
                  route,
                };
                return copy;
              });
            }
          } catch {
            // skip
          }
        }
      }
    }

    const finalMessages: ChatMessage[] = [
      ...updatedMessages,
      { role: "assistant", content: fullContent, route },
    ];
    setMessages(finalMessages);
    debouncedSave(finalMessages, convId);

    const lastUserMsg = updatedMessages.filter(m => m.role === "user").pop();
    trackUsage({
      model: route.model,
      route: route.type,
      inputText: lastUserMsg?.content || "",
      outputText: fullContent,
    });
  };

  const emailReply = (
    text: string,
    route: RouteResult,
    msgs: ChatMessage[],
    convId: string | null,
    extras?: { emails?: EmailData[]; mailbox?: string }
  ) => {
    const msg: ChatMessage = { role: "assistant", content: text, route };
    if (extras?.emails) msg.emails = extras.emails;
    if (extras?.mailbox) msg.mailbox = extras.mailbox;
    const finalMsgs: ChatMessage[] = [...msgs, msg];
    setMessages(finalMsgs);
    debouncedSave(finalMsgs, convId);
    trackUsage({ model: route.model, route: "email", outputText: text });
  };

  const detectMailbox = (text: string): string => {
    const l = text.toLowerCase();
    if (/adsun|info@adsun|firemn[ýeé]|firma/.test(l)) return "adsun";
    if (/juraj@|juraj\s*(adsun|mail)|moj\s*pracovn/.test(l)) return "juraj";
    if (/osobn[áeé]|moje\s*mail|gmail|personal/.test(l)) return "personal";
    return "personal";
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const toEmailData = (e: any): EmailData => {
    // IMAP: from="Name <email>", snippet
    // Graph: sender="Name", sender_email="email", body="...", is_read
    const from = e.from
      || (e.sender_email ? `${e.sender || ""} <${e.sender_email}>`.trim() : e.sender)
      || e.sender?.emailAddress?.address
      || "?";
    return {
      from,
      subject: e.subject || "(bez predmetu)",
      date: e.date || e.receivedDateTime || "",
      snippet: e.snippet || e.bodyPreview || e.body?.slice?.(0, 200) || "",
      id: e.id || e.messageId || undefined,
      unread: e.isRead === false || e.is_read === false,
    };
  };

  const showEmailPreview = (
    to: string, subject: string, body: string, mailbox: string,
    route: RouteResult, msgs: ChatMessage[], convId: string | null
  ) => {
    pendingEmailRef.current = { to, subject, body, mailbox };
    const mailboxLabel = mailbox === "adsun" ? "info@adsun.sk" : mailbox === "juraj" ? "juraj@adsun.sk" : "osobná schránka";
    emailReply(
      `✉️ Návrh emailu (${mailboxLabel})\n\n` +
      `📬 Komu: ${to}\n` +
      `📝 Predmet: ${subject}\n\n` +
      `${body}\n\n` +
      `─── Akcie ───\n` +
      `"pošli" — odoslať\n` +
      `"zmeň adresu/predmet/text na..." — upraviť\n` +
      `"zruš" — zrušiť`,
      route, msgs, convId
    );
  };

  const callGemini = async (prompt: string): Promise<string | null> => {
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt: GEMINI_EMAIL_SYSTEM, prompt }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.text || null;
      if (text) {
        trackUsage({ model: "gemini-2.0-flash", route: "classify", inputText: prompt, outputText: text });
      }
      return text;
    } catch { return null; }
  };

  const handleEmailInChat = async (
    userText: string,
    route: RouteResult,
    updatedMessages: ChatMessage[],
    convId: string | null
  ) => {
    const mailbox = detectMailbox(userText);

    // If draft is waiting for address, try to resolve
    if (draftEmailRef.current && draftEmailRef.current.missing.includes("adresa príjemcu")) {
      const emailMatch = userText.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
      const parsed = parseEmailCommand(`posli mail ${userText}`);
      const resolvedTo = emailMatch?.[0] || parsed?.to || null;

      if (resolvedTo) {
        const draft = draftEmailRef.current;
        draftEmailRef.current = null;
        const geminiText = await callGemini(`${draft.originalText} na adresu ${resolvedTo}`);
        let subject = draft.subject || "Bez predmetu";
        let body = draft.body || draft.originalText;
        if (geminiText) {
          const jm = geminiText.match(/\{[\s\S]*?"intent"[\s\S]*?\}/);
          if (jm) { try { const c = JSON.parse(jm[0]); if (c.subject) subject = c.subject; if (c.body) body = c.body; } catch {} }
        }
        showEmailPreview(resolvedTo, subject, body, draft.mailbox, route, updatedMessages, convId);
        return;
      }
    }

    // Ask Gemini to understand intent
    const geminiText = await callGemini(userText);
    if (!geminiText) {
      emailReply("Nepodarilo sa spojiť s Gemini. Skontroluj pripojenie.", route, updatedMessages, convId);
      return;
    }

    let intent: Record<string, unknown> = { intent: "list" };
    const jsonMatch = geminiText.match(/\{[\s\S]*?"intent"[\s\S]*?\}/);
    if (jsonMatch) {
      try { intent = JSON.parse(jsonMatch[0]); } catch {}
    }

    const action = (intent.intent as string) || "list";

    // ── SEND ──
    if (action === "send") {
      const parsed = parseEmailCommand(userText);
      const to = parsed.to;

      if (!to) {
        draftEmailRef.current = {
          originalText: userText,
          subject: (intent.subject as string) || parsed.subject,
          body: (intent.body as string) || parsed.body,
          mailbox,
          missing: ["adresa príjemcu"],
        };
        const contacts = getContacts();
        const contactList = contacts.map((c) => `- **${c.name}** → ${c.email}`).join("\n");
        emailReply(`Na akú adresu mám email poslať?\n\n${contactList}`, route, updatedMessages, convId);
        return;
      }

      const subject = (intent.subject as string) || parsed.subject || "Bez predmetu";
      const body = (intent.body as string) || parsed.body || userText;
      showEmailPreview(to, subject, body, mailbox, route, updatedMessages, convId);
      return;
    }

    // ── SEARCH ──
    if (action === "search") {
      const query = (intent.query as string) || userText;
      try {
        const res = await fetch("/api/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", mailbox, query, limit: 10 }),
        });
        const data = await res.json();
        const emails = data.emails || [];
        if (emails.length === 0) {
          emailReply(`Nenašiel som žiadne emaily pre: "${query}"`, route, updatedMessages, convId);
          return;
        }
        const emailCards: EmailData[] = emails.map(toEmailData);
        emailReply(`Výsledky hľadania "${query}":`, route, updatedMessages, convId, { emails: emailCards, mailbox });
      } catch { emailReply("Nepodarilo sa vyhľadať emaily.", route, updatedMessages, convId); }
      return;
    }

    // ── CLEANUP ──
    if (action === "cleanup") {
      try {
        const res = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cleanup", dry_run: true }) });
        const data = await res.json();
        emailReply(`**Cleanup analýza:**\n- Marketing: **${data.marketing_found || 0}**\n- Staré (365+ dní): **${data.old_found || 0}**\n\nNapíš **"vymaž ich"** na potvrdenie.`, route, updatedMessages, convId);
      } catch { emailReply("Nepodarilo sa analyzovať emaily.", route, updatedMessages, convId); }
      return;
    }

    // ── READ ──
    if (action === "read") {
      const num = (intent.number as number) || 1;
      const idx = num - 1;
      try {
        const listRes = await fetch(`/api/email?mailbox=${mailbox}&limit=20`);
        const listData = await listRes.json();
        const emails = listData.emails || [];
        const target = emails[idx];
        if (target?.id) {
          const readRes = await fetch("/api/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", mailbox, id: target.id }) });
          const detail = await readRes.json();
          const bodyText = detail.body?.content || detail.body || detail.snippet || "Bez obsahu";
          const emailCard: EmailData[] = [toEmailData({ ...target, body: bodyText })];
          emailReply(bodyText, route, updatedMessages, convId, { emails: emailCard, mailbox });
        } else {
          emailReply(`Email č. ${num} neexistuje. Najprv si nechaj zobraziť maily.`, route, updatedMessages, convId);
        }
      } catch { emailReply("Nepodarilo sa prečítať email.", route, updatedMessages, convId); }
      return;
    }

    // ── LIST (default) ──
    try {
      const today = !!(intent.today);
      const res = await fetch(`/api/email?today=${today}&limit=20&mailbox=${mailbox}`);
      const data = await res.json();
      if (data.error) { emailReply(`Chyba: ${data.error}`, route, updatedMessages, convId); return; }
      const emails = data.emails || [];
      if (emails.length === 0) { emailReply(today ? "Dnes nemáš žiadne nové emaily." : "Nemáš žiadne neprečítané emaily.", route, updatedMessages, convId); return; }

      const emailCards: EmailData[] = emails.map(toEmailData);
      emailReply("", route, updatedMessages, convId, { emails: emailCards, mailbox });
    } catch {
      emailReply("Nepodarilo sa načítať emaily. Skontroluj pripojenie.", route, updatedMessages, convId);
    }
  };

  const calendarReply = (
    text: string,
    route: RouteResult,
    msgs: ChatMessage[],
    convId: string | null,
    events?: CalendarEventData[]
  ) => {
    const msg: ChatMessage = { role: "assistant", content: text, route };
    if (events) msg.calendarEvents = events;
    const finalMsgs: ChatMessage[] = [...msgs, msg];
    setMessages(finalMsgs);
    debouncedSave(finalMsgs, convId);
    trackUsage({ model: route.model, route: "calendar", outputText: text });
  };

  const handleCalendarInChat = async (
    userText: string,
    route: RouteResult,
    updatedMessages: ChatMessage[],
    convId: string | null
  ) => {
    const loadingMsg: ChatMessage = { role: "assistant", content: "", route };
    setMessages([...updatedMessages, loadingMsg]);

    // Use Gemini to classify the calendar intent
    const calPrompt = `Analyzuj túto správu o kalendári a vráť JSON:
- "list" — zobraziť udalosti (dnes, tento týždeň, dátum)
- "create" — vytvoriť novú udalosť
- "delete" — zmazať udalosť
- "search" — hľadať udalosť

Pre "list": {"action":"list","period":"today"|"week"|"month"}
Pre "create": {"action":"create","subject":"...","date":"YYYY-MM-DD","time":"HH:MM","duration_hours":1,"location":"..."}
Pre "delete": {"action":"delete","number":1}
Pre "search": {"action":"search","query":"..."}

Dnešný dátum: ${new Date().toISOString().slice(0, 10)}
Správa: "${userText}"
Odpovedz IBA JSON, nič iné.`;

    let intent: Record<string, unknown> = { action: "list", period: "today" };
    try {
      const classRes = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: calPrompt }),
      });
      const classData = await classRes.json();
      const raw = (classData.text || classData.content || "").replace(/```json?\n?/g, "").replace(/```/g, "").trim();
      intent = JSON.parse(raw);
    } catch {
      // default to today's list
    }

    const action = (intent.action as string) || "list";

    // ── CREATE ──
    if (action === "create") {
      const subject = (intent.subject as string) || "Nová udalosť";
      const date = (intent.date as string) || new Date().toISOString().slice(0, 10);
      const time = (intent.time as string) || "09:00";
      const durationH = (intent.duration_hours as number) || 1;
      const location = (intent.location as string) || "";

      const start = `${date}T${time}:00`;
      const endDate = new Date(new Date(start).getTime() + durationH * 3600000);
      const end = endDate.toISOString().slice(0, 19);

      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            subject,
            start,
            end,
            location,
            account: "juraj",
          }),
        });
        const data = await res.json();
        if (data.error) {
          calendarReply(`Chyba: ${data.error}`, route, updatedMessages, convId);
        } else {
          calendarReply(
            `✅ Udalosť vytvorená!\n\n📅 ${subject}\n🕐 ${date} ${time} (${durationH}h)${location ? `\n📍 ${location}` : ""}`,
            route, updatedMessages, convId,
            [data]
          );
        }
      } catch {
        calendarReply("Nepodarilo sa vytvoriť udalosť.", route, updatedMessages, convId);
      }
      return;
    }

    // ── SEARCH ──
    if (action === "search") {
      const query = (intent.query as string) || userText;
      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "search", query, account: "juraj" }),
        });
        const data = await res.json();
        const events = data.events || [];
        if (events.length === 0) {
          calendarReply(`Nenašiel som žiadne udalosti pre "${query}".`, route, updatedMessages, convId);
        } else {
          calendarReply(`Výsledky pre "${query}":`, route, updatedMessages, convId, events);
        }
      } catch {
        calendarReply("Nepodarilo sa vyhľadať v kalendári.", route, updatedMessages, convId);
      }
      return;
    }

    // ── DELETE ──
    if (action === "delete") {
      const num = (intent.number as number) || 1;
      calendarReply(
        `Pre zmazanie udalosti č. ${num} mi najprv zobraz kalendár príkazom "čo mám dnes" alebo "tento týždeň".`,
        route, updatedMessages, convId
      );
      return;
    }

    // ── LIST (default) ──
    const period = (intent.period as string) || "today";
    try {
      const view = period === "week" || period === "month" ? "week" : "today";
      const res = await fetch(`/api/calendar?view=${view}&account=juraj`);
      const data = await res.json();
      if (data.error) {
        calendarReply(`Chyba: ${data.error}`, route, updatedMessages, convId);
        return;
      }
      const events = data.events || [];
      const label = view === "today" ? "Dnešný program" : "Tento týždeň";
      if (events.length === 0) {
        calendarReply(view === "today" ? "Dnes nemáš žiadne udalosti. 🎉" : "Tento týždeň nemáš žiadne udalosti.", route, updatedMessages, convId);
      } else {
        calendarReply("", route, updatedMessages, convId, events);
      }
    } catch {
      calendarReply("Nepodarilo sa načítať kalendár. Skontroluj pripojenie.", route, updatedMessages, convId);
    }
  };

  const sendMessage = useCallback(
    async (content: string) => {
      const userMsg: ChatMessage = { role: "user", content };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setIsStreaming(true);

      // Check for pending email modifications or confirmation
      const lowerTrimmed = content.toLowerCase().trim();

      if (pendingEmailRef.current) {
        const emailRoute: RouteResult = { type: "email", model: "jalza", label: "Email", icon: "📧" };
        const pending = pendingEmailRef.current;

        // Cancel
        if (/^(nie|cancel|zrus|zruš|nechci|stop)$/i.test(lowerTrimmed)) {
          setCurrentRoute(emailRoute);
          pendingEmailRef.current = null;
          emailReply("Email zrušený.", emailRoute, updated, conversationId);
          setIsStreaming(false);
          return;
        }

        // Modify address
        const addrChange = content.match(/zme[nň]\s*adres\w*\s*na\s+(.+)/i)
          || content.match(/komu\s*(?:na|:)\s*(.+)/i)
          || content.match(/na\s+([\w.-]+@[\w.-]+\.\w{2,})/i);
        if (addrChange) {
          const newParsed = parseEmailCommand(`posli mail ${addrChange[1]}`);
          const newTo = content.match(/[\w.-]+@[\w.-]+\.\w{2,}/)?.[0] || newParsed?.to;
          if (newTo) {
            setCurrentRoute(emailRoute);
            pending.to = newTo;
            emailReply(
              `**Adresa zmenená!** Aktualizovaný návrh:\n\n` +
              `📬 **Komu:** ${pending.to}\n` +
              `📝 **Predmet:** ${pending.subject}\n\n` +
              `---\n\n${pending.body}\n\n---\n\n` +
              `**"pošli"** — odoslať | **"zruš"** — zrušiť`,
              emailRoute, updated, conversationId
            );
            setIsStreaming(false);
            return;
          }
        }

        // Modify subject
        const subjChange = content.match(/zme[nň]\s*predmet\w*\s*na\s+(.+)/i)
          || content.match(/predmet\s*(?:bude|:)\s*(.+)/i);
        if (subjChange) {
          setCurrentRoute(emailRoute);
          pending.subject = subjChange[1].trim();
          emailReply(
            `**Predmet zmenený!** Aktualizovaný návrh:\n\n` +
            `📬 **Komu:** ${pending.to}\n` +
            `📝 **Predmet:** ${pending.subject}\n\n` +
            `---\n\n${pending.body}\n\n---\n\n` +
            `**"pošli"** — odoslať | **"zruš"** — zrušiť`,
            emailRoute, updated, conversationId
          );
          setIsStreaming(false);
          return;
        }

        // Modify body
        const bodyChange = content.match(/zme[nň]\s*(?:text|obsah|telo)\w*\s*na\s+(.+)/i)
          || content.match(/(?:text|obsah|telo)\s*(?:bude|:)\s*(.+)/i);
        if (bodyChange) {
          setCurrentRoute(emailRoute);
          pending.body = bodyChange[1].trim();
          emailReply(
            `**Text zmenený!** Aktualizovaný návrh:\n\n` +
            `📬 **Komu:** ${pending.to}\n` +
            `📝 **Predmet:** ${pending.subject}\n\n` +
            `---\n\n${pending.body}\n\n---\n\n` +
            `**"pošli"** — odoslať | **"zruš"** — zrušiť`,
            emailRoute, updated, conversationId
          );
          setIsStreaming(false);
          return;
        }
      }

      const isConfirm = /^(ano|ok|yes|posli|pošli|potvrd|potvrdzujem|odosli|odošli|send|potvrď)(\s+(to|ho|mail|email))*[.!?]*$/i.test(lowerTrimmed)
        || /^ok\s+posli/i.test(lowerTrimmed)
        || /^ano\s+(posli|pošli|odosli|odošli)/i.test(lowerTrimmed)
        || /^(posli|pošli|odosli|odošli)\s+(to|ho|mail|email)/i.test(lowerTrimmed);

      if (pendingEmailRef.current && isConfirm) {
        const emailRoute: RouteResult = { type: "email", model: "jalza", label: "Email", icon: "📧" };
        setCurrentRoute(emailRoute);
        const pending = pendingEmailRef.current;
        pendingEmailRef.current = null;
        try {
          const sendRes = await fetch("/api/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "send",
              mailbox: pending.mailbox,
              to: pending.to,
              subject: pending.subject,
              body: pending.body,
            }),
          });
          const sendData = await sendRes.json();
          if (sendData.status === "sent") {
            emailReply(
              `**Email odoslaný!**\n- **Komu:** ${pending.to}\n- **Predmet:** ${pending.subject}`,
              emailRoute, updated, conversationId
            );
          } else {
            emailReply(`Chyba pri odoslaní: ${sendData.error || "neznáma chyba"}`, emailRoute, updated, conversationId);
          }
        } catch {
          emailReply("Nepodarilo sa odoslať email.", emailRoute, updated, conversationId);
        } finally {
          setIsStreaming(false);
        }
        return;
      }

      // If draft exists, force email route so handleEmailInChat can resolve it
      if (draftEmailRef.current) {
        const emailRoute: RouteResult = { type: "email", model: "jalza", label: "Email", icon: "📧" };
        setCurrentRoute(emailRoute);
        try {
          await handleEmailInChat(content, emailRoute, updated, conversationId);
        } catch {
          emailReply("Chyba pri spracovaní emailu.", emailRoute, updated, conversationId);
        } finally {
          setIsStreaming(false);
        }
        return;
      }

      // Cancel pending email only on clearly different topic
      if (pendingEmailRef.current && !/mail|email|posli|pošli|ano|ok|potvrd|potvrď|odosli|odošli|send|yes/i.test(lowerTrimmed)) {
        pendingEmailRef.current = null;
      }

      const route = await detectRoute(
        content,
        !!activeAgent,
        activeAgent?.key,
        activeAgent?.name
      );
      setCurrentRoute(route);

      try {
        let plainMessages = updated.map(({ role, content: c }) => ({
          role,
          content: c,
        }));

        if (route.type === "email") {
          await handleEmailInChat(content, route, updated, conversationId);
          return;
        }

        if (route.type === "calendar") {
          await handleCalendarInChat(content, route, updated, conversationId);
          return;
        }

        if (route.type === "image") {
          const assistantMsg: ChatMessage = { role: "assistant", content: "", route };
          const withAssistant = [...updated, assistantMsg];
          setMessages(withAssistant);

          try {
            const res = await fetch("/api/generate-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: content }),
            });
            const data = await res.json();

            if (data.image) {
              const imgMsg: ChatMessage = {
                role: "assistant",
                content: data.text || "",
                route,
                generatedImage: data.image,
              };
              const finalMsgs = [...updated, imgMsg];
              setMessages(finalMsgs);
              debouncedSave(finalMsgs, conversationId);
              trackUsage({ model: "gemini-image", route: "image", outputText: data.text || "" });
            } else {
              const errMsg: ChatMessage = {
                role: "assistant",
                content: data.error || "Nepodarilo sa vygenerovať obrázok.",
                route,
              };
              const finalMsgs = [...updated, errMsg];
              setMessages(finalMsgs);
              debouncedSave(finalMsgs, conversationId);
            }
          } catch {
            const errMsg: ChatMessage = {
              role: "assistant",
              content: "Chyba pri generovaní obrázku. Skontroluj pripojenie.",
              route,
            };
            setMessages([...updated, errMsg]);
          } finally {
            setIsStreaming(false);
          }
          return;
        }

        if (route.type === "search") {
          const loc = await getLocation();
          const now = new Date();
          const dateStr = now.toLocaleDateString("sk-SK", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
          });
          const timeStr = now.toLocaleTimeString("sk-SK", {
            hour: "2-digit",
            minute: "2-digit",
          });

          let context = `[Dátum: ${dateStr}, Čas: ${timeStr}]`;
          if (loc) {
            context += ` [Poloha používateľa: ${loc.city}, ${loc.country}]`;
          }

          const lastIdx = plainMessages.length - 1;
          const lastMsg = plainMessages[lastIdx];
          plainMessages[lastIdx] = {
            ...lastMsg,
            content: `${context}\n\n${lastMsg.content}`,
          };
          await streamResponse("/api/search", { messages: plainMessages }, route, updated, conversationId);
        } else if (route.type === "knowledge" && route.agentKey) {
          await streamResponse(
            "/api/chat",
            {
              messages: plainMessages,
              agent: { key: route.agentKey, name: route.agentName },
            },
            route,
            updated,
            conversationId
          );
        } else if (selectedModel.provider === "gemini") {
          const geminiRoute: RouteResult = {
            type: "text",
            model: selectedModel.model,
            label: selectedModel.name,
            icon: selectedModel.icon,
          };
          setCurrentRoute(geminiRoute);
          await streamResponse(
            "/api/gemini-chat",
            { messages: plainMessages, model: selectedModel.model },
            geminiRoute,
            updated,
            conversationId
          );
        } else {
          await streamResponse("/api/chat", { messages: plainMessages }, route, updated, conversationId);
        }
      } catch (err) {
        const errorMessages: ChatMessage[] = [
          ...updated,
          {
            role: "assistant",
            content: `Chyba: ${err instanceof Error ? err.message : "Unknown"}`,
            route,
          },
        ];
        setMessages(errorMessages);
        debouncedSave(errorMessages, conversationId);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, activeAgent, conversationId, debouncedSave]
  );

  const sendVisionMessage = useCallback(
    async (content: string, imageBase64: string) => {
      const route: RouteResult = {
        type: "text",
        model: "qwen2.5vl:3b",
        label: "Vision",
        icon: "👁",
      };
      setCurrentRoute(route);

      const displayContent = content || "Analyzuj tento obrázok";
      const userMsg: ChatMessage = {
        role: "user",
        content: `📷 ${displayContent}`,
        route,
      };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setIsStreaming(true);

      try {
        await streamResponse(
          "/api/vision",
          { prompt: content, images: [imageBase64] },
          route,
          updated,
          conversationId
        );
      } catch (err) {
        const errorMessages: ChatMessage[] = [
          ...updated,
          {
            role: "assistant",
            content: `Chyba: ${err instanceof Error ? err.message : "Unknown"}`,
            route,
          },
        ];
        setMessages(errorMessages);
        debouncedSave(errorMessages, conversationId);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, conversationId, debouncedSave]
  );

  const clearChat = useCallback(() => {
    setMessages([]);
    setCurrentRoute(null);
    setConversationId(null);
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const convo = await getConversation(id);
    if (convo) {
      setMessages(
        convo.messages.map((m) => ({
          role: m.role,
          content: m.content,
          route: m.route,
        }))
      );
      setConversationId(convo.id);
      setCurrentRoute(null);
    }
  }, []);

  return {
    messages,
    isStreaming,
    sendMessage,
    sendVisionMessage,
    clearChat,
    currentRoute,
    conversationId,
    loadConversation,
    selectedModel,
    setSelectedModel,
  };
}
