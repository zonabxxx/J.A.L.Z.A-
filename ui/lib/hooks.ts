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
import { fetchMailboxes, buildMailboxPromptContext, detectMailboxByEmail, type Mailbox } from "./mailboxes";
import { getFeatures } from "./features";

function buildEmailSystemPrompt(mailboxes: Mailbox[]): string {
  const mbList = buildMailboxPromptContext(mailboxes);
  return `Si JSON parser pre emailové príkazy. VŽDY odpovedz IBA platným JSON objektom, nič iné.

INTENT typy: "chat", "send", "list", "search", "read", "reply", "cleanup"

POLIA:
- "intent": (povinné) jeden z typov vyššie
- "response": (pre "chat") tvoja odpoveď po slovensky
- "today": true ak spomína "dnes", "dnešné", "dnešného dňa", "today"
- "limit": počet emailov ak je uvedený
- "mailbox": ID schránky (${mbList})
- "filter": meno/firma na filtrovanie (napr. "od Petra" → "Peter")
- "query": hľadaný výraz pre search
- "number": číslo emailu pre read/reply
- "to": emailová adresa príjemcu pre send
- "subject": predmet emailu pre send
- "body": text emailu pre send

PRAVIDLÁ:
- Ak sa používateľ PÝTA otázku ("môžem?", "vieš?", "ako?") → použi "chat" a odpovedz
- Ak chce poslať mail ale chýba adresa/predmet/text → použi "chat" a opýtaj sa čo chýba
- Ak dáva jasný príkaz → použi príslušný intent

PRÍKLADY:
"maily z dneška" → {"intent":"list","today":true}
"juraj maily z dneška" → {"intent":"list","today":true,"mailbox":"juraj"}
"adsun maily" → {"intent":"list","mailbox":"adsun"}
"prečítaj mail 3" → {"intent":"read","number":3}
"hľadaj faktúra" → {"intent":"search","query":"faktúra"}
"odpovedz na 1" → {"intent":"reply","number":1}
"pošli mail na info@firma.sk predmet Test text Ahoj" → {"intent":"send","to":"info@firma.sk","subject":"Test","body":"Ahoj"}
"vymaž spam" → {"intent":"cleanup"}
"vieš posielať maily?" → {"intent":"chat","response":"Áno, viem posielať, čítať a vyhľadávať emaily. Čo potrebuješ?"}
"napíš mail" → {"intent":"chat","response":"Komu mám poslať mail? Povedz mi adresu, predmet a čo chceš napísať."}

DÔLEŽITÉ: Odpovedz IBA JSON. Žiadny text pred ani za JSON.`;
}

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

export interface PendingCalendarEvent {
  subject: string;
  date: string;
  time: string;
  endTime: string;
  durationH: number;
  location: string;
  body: string;
  attendees: string[];
  dayName: string;
}

export interface ChatMessage extends Message {
  route?: RouteResult;
  emails?: EmailData[];
  mailbox?: string;
  todayFilter?: boolean;
  generatedImage?: string;
  uploadedImage?: string;
  calendarEvents?: CalendarEventData[];
  pendingCalendarEvent?: PendingCalendarEvent;
}

export function useChat(activeAgent: Agent | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteResult | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(AVAILABLE_MODELS[0]);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abortRef = useRef<AbortController | null>(null);

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

  const lastMailboxRef = useRef<string>("personal");
  const lastTodayFilterRef = useRef<boolean>(false);

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

    if (!res.ok || !res.body) {
      let detail = `${res.status}`;
      try { const d = await res.json(); detail = d.error || JSON.stringify(d); } catch { /* */ }
      throw new Error(`Chyba (${res.status}): ${detail}`);
    }

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
    extras?: { emails?: EmailData[]; mailbox?: string; todayFilter?: boolean }
  ) => {
    const msg: ChatMessage = { role: "assistant", content: text, route };
    if (extras?.emails) msg.emails = extras.emails;
    if (extras?.mailbox) msg.mailbox = extras.mailbox;
    if (extras?.todayFilter !== undefined) msg.todayFilter = extras.todayFilter;
    const finalMsgs: ChatMessage[] = [...msgs, msg];
    setMessages(finalMsgs);
    debouncedSave(finalMsgs, convId);
    trackUsage({ model: route.model, route: "email", outputText: text });
  };

  const detectMailbox = (text: string, mailboxes: Mailbox[]): string => {
    // First try exact email match from config
    const emailMatch = detectMailboxByEmail(text, mailboxes);
    if (emailMatch) return emailMatch;

    // Then try label/id match
    const lower = text.toLowerCase();
    for (const mb of mailboxes) {
      if (lower.includes(mb.id.toLowerCase()) || lower.includes(mb.label.toLowerCase())) {
        return mb.id;
      }
    }

    // No match — use last used mailbox (for "prečítaj mail 1" etc.)
    return lastMailboxRef.current;
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
    const mailboxLabel = mailbox;
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

  const callAI = async (prompt: string, mailboxes?: Mailbox[]): Promise<string | null> => {
    try {
      const mbs = mailboxes || await fetchMailboxes();
      const systemPrompt = buildEmailSystemPrompt(mbs);
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ systemPrompt, prompt, task_type: "email_intent" }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const text = data.text || null;
      if (text) {
        trackUsage({ model: "jalza", route: "email-intent", inputText: prompt, outputText: text });
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
    const mailboxes = await fetchMailboxes();
    let mailbox = detectMailbox(userText, mailboxes);

    // If draft is waiting for address, try to resolve
    if (draftEmailRef.current && draftEmailRef.current.missing.includes("adresa príjemcu")) {
      const emailMatch = userText.match(/[\w.-]+@[\w.-]+\.\w{2,}/);
      const parsed = parseEmailCommand(`posli mail ${userText}`);
      const resolvedTo = emailMatch?.[0] || parsed?.to || null;

      if (resolvedTo) {
        const draft = draftEmailRef.current;
        draftEmailRef.current = null;
        const aiText = await callAI(`${draft.originalText} na adresu ${resolvedTo}`);
        let subject = draft.subject || "Bez predmetu";
        let body = draft.body || draft.originalText;
        if (aiText) {
          const jm = aiText.match(/\{[\s\S]*?"intent"[\s\S]*?\}/);
          if (jm) { try { const c = JSON.parse(jm[0]); if (c.subject) subject = c.subject; if (c.body) body = c.body; } catch {} }
        }
        showEmailPreview(resolvedTo, subject, body, draft.mailbox, route, updatedMessages, convId);
        return;
      }
    }

    const aiText = await callAI(userText, mailboxes);
    if (!aiText) {
      emailReply("Nepodarilo sa spojiť s AI. Skontroluj pripojenie.", route, updatedMessages, convId);
      return;
    }

    let intent: Record<string, unknown> = { intent: "list" };
    const jsonMatch = aiText.match(/\{[\s\S]*?"intent"[\s\S]*?\}/);
    if (jsonMatch) {
      try { intent = JSON.parse(jsonMatch[0]); } catch {}
    }

    const action = (intent.intent as string) || "list";

    if (intent.mailbox) {
      const mb = (intent.mailbox as string).toLowerCase();
      if (mailboxes.some(m => m.id === mb)) mailbox = mb;
    }

    lastMailboxRef.current = mailbox;

    // ── CHAT (conversational response) ──
    if (action === "chat") {
      const response = (intent.response as string) || "Ako ti môžem pomôcť s emailami?";
      emailReply(response, route, updatedMessages, convId);
      return;
    }

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
      const intentHasMailbox = !!intent.mailbox;
      const intentHasToday = intent.today !== undefined;
      // If user only switched mailbox (e.g. "adsun maily") and previously had today filter, keep it
      const today = intentHasToday
        ? !!(intent.today)
        : (intentHasMailbox && lastTodayFilterRef.current)
          ? true
          : false;
      lastTodayFilterRef.current = today;

      const requestLimit = (intent.limit as number) || 20;
      const filter = (intent.filter as string) || "";
      const res = await fetch(`/api/email?today=${today}&limit=${Math.min(requestLimit * 2, 50)}&mailbox=${mailbox}`);
      const data = await res.json();
      if (data.error) { emailReply(`Chyba: ${data.error}`, route, updatedMessages, convId); return; }
      let emails = data.emails || [];

      if (filter) {
        const f = filter.toLowerCase();
        emails = emails.filter((e: Record<string, unknown>) => {
          const from = ((e.from as string) || (e.sender as string) || (e.sender_email as string) || "").toLowerCase();
          const subj = ((e.subject as string) || "").toLowerCase();
          const body = ((e.snippet as string) || (e.bodyPreview as string) || (e.body as string) || "").toLowerCase();
          return from.includes(f) || subj.includes(f) || body.includes(f);
        });
      }

      if (intent.limit) {
        emails = emails.slice(0, requestLimit);
      }

      if (emails.length === 0) {
        const msg = filter
          ? `Nenašiel som žiadne emaily pre "${filter}" v schránke ${mailbox}.`
          : today ? "Dnes nemáš žiadne nové emaily." : "Nemáš žiadne neprečítané emaily.";
        emailReply(msg, route, updatedMessages, convId);
        return;
      }

      const emailCards: EmailData[] = emails.map(toEmailData);
      emailReply("", route, updatedMessages, convId, { emails: emailCards, mailbox, todayFilter: today });
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

    const now = new Date();
    const dayNames = ["nedeľa","pondelok","utorok","streda","štvrtok","piatok","sobota"];
    const todayName = dayNames[now.getDay()];

    const recentContext = updatedMessages
      .slice(-6)
      .map(m => `${m.role === "user" ? "Používateľ" : "Asistent"}: ${m.content}`)
      .join("\n");

    const calPrompt = `Analyzuj konverzáciu o kalendári a vráť JSON.

TYPY AKCIÍ:
- "chat" — používateľ sa PÝTA otázku, chce konverzovať, alebo nemá dosť info na akciu. Odpovedz mu.
- "need_details" — používateľ chce vytvoriť udalosť, ale CHÝBAJÚ mu dôležité detaily (čo, kedy). Opýtaj sa.
- "list" — zobraziť udalosti
- "create" — vytvoriť novú udalosť (iba ak je jasný PREDMET aj DÁTUM)
- "delete" — zmazať udalosť
- "search" — hľadať udalosť

FORMÁTY:
Pre "chat": {"action":"chat","response":"...tvoja odpoveď po slovensky..."}
Pre "need_details": {"action":"need_details","response":"...opýtaj sa čo chýba...","partial":{"subject":"...","date":"..."}}
Pre "list": {"action":"list","period":"today"|"week"|"month"}
Pre "create": {"action":"create","subject":"...","date":"YYYY-MM-DD","time":"HH:MM","duration_hours":1,"location":"...","body":"...","attendees":["email1",...]}
Pre "delete": {"action":"delete","number":1}
Pre "search": {"action":"search","query":"..."}

PRAVIDLÁ:
- Dnešný dátum: ${now.toISOString().slice(0, 10)} (${todayName})
- Ak používateľ sa PÝTA (napr. "viem tu...?", "môžem...?", "ako...?") → použi "chat" a odpovedz mu
- Ak používateľ chce vytvoriť ale nepovie ČO konkrétne alebo KEDY → použi "need_details" a opýtaj sa na detaily
- NIKDY nevymýšľaj predmet alebo čas — ak ti ho používateľ nepovedal, použi "need_details"
- Použi "create" IBA keď máš jasný predmet A dátum/čas od používateľa
- Ak povie "pondelok", mysli NAJBLIŽŠÍ pondelok
- Ak spomína firmu/adresu → "location", osoby → "subject", popis → "body"
- AK POUŽÍVATEĽ POVIE "áno" alebo "potvrď" — pozri sa na PREDCHÁDZAJÚCU konverzáciu

KONVERZÁCIA:
${recentContext}

POSLEDNÁ SPRÁVA: "${userText}"
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

    // ── CHAT (conversational response) ──
    if (action === "chat" || action === "need_details") {
      const response = (intent.response as string) || "Áno, môžem ti pomôcť s kalendárom. Povedz mi čo potrebuješ.";
      calendarReply(response, route, updatedMessages, convId);
      return;
    }

    // ── CREATE ──
    if (action === "create") {
      const subject = (intent.subject as string) || "Nová udalosť";
      const date = (intent.date as string) || new Date().toISOString().slice(0, 10);
      const time = (intent.time as string) || "09:00";
      const durationH = (intent.duration_hours as number) || 1;
      const location = (intent.location as string) || "";
      const bodyText = (intent.body as string) || "";
      const attendees = (intent.attendees as string[]) || [];

      const endDate = new Date(new Date(`${date}T${time}:00`).getTime() + durationH * 3600000);
      const endTime = `${String(endDate.getHours()).padStart(2,"0")}:${String(endDate.getMinutes()).padStart(2,"0")}`;
      const dayOfWeek = dayNames[new Date(date).getDay()] || "";

      const pending: PendingCalendarEvent = {
        subject, date, time, endTime, durationH,
        location, body: bodyText, attendees, dayName: dayOfWeek,
      };

      const confirmMsg: ChatMessage = {
        role: "assistant",
        content: "Skontroluj detaily a potvrď vytvorenie:",
        route,
        pendingCalendarEvent: pending,
      };
      const finalMsgs = [...updatedMessages, confirmMsg];
      setMessages(finalMsgs);
      debouncedSave(finalMsgs, convId);
      setIsStreaming(false);
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

  const readEmailById = useCallback(
    async (emailId: string, mailbox: string) => {
      const route: RouteResult = { type: "email", model: "gemini-2.5-flash", label: "Email · jalza", icon: "📧" };
      setCurrentRoute(route);
      setIsStreaming(true);

      const loadingMsg: ChatMessage = { role: "assistant", content: "Čítam email…", route };
      const updated = [...messages, loadingMsg];
      setMessages(updated);

      try {
        const res = await fetch("/api/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "read", mailbox, id: emailId }),
        });
        const detail = await res.json();
        if (detail.error) {
          const errMsg: ChatMessage = { role: "assistant", content: `Chyba: ${detail.error}`, route };
          setMessages([...messages, errMsg]);
          debouncedSave([...messages, errMsg], conversationId);
          return;
        }

        const bodyText = detail.body?.content || detail.body || detail.snippet || "Bez obsahu";
        const fromAddr = detail.sender || detail.sender_email || detail.from || "neznámy";
        const subject = detail.subject || "(bez predmetu)";

        const aiPrompt = [
          `Prečítal som email. Zhrň ho používateľovi po SLOVENSKY, jasne a zrozumiteľne.`,
          `Ak email obsahuje dôležité dátumy, sumy, pokyny alebo akcie, zvýrazni ich.`,
          `Ak niečo nie je jasné alebo chýbajú informácie, upozorni na to a opýtaj sa čo chce urobiť ďalej (odpovedať, preposlať, archivovať...).`,
          ``,
          `Od: ${fromAddr}`,
          `Predmet: ${subject}`,
          `---`,
          bodyText,
        ].join("\n");

        let summary: string;
        try {
          const aiRes = await fetch("/api/gemini", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: aiPrompt,
              systemPrompt: "Si J.A.L.Z.A., inteligentný asistent. Odpovedáš VŽDY po SLOVENSKY. Keď ti používateľ dá email, zhrň jeho obsah prirodzene — čo kto píše, čo chce, aké sú dôležité body. Na konci sa opýtaj či chce odpovedať, preposlať alebo niečo iné.",
            }),
          });
          const aiData = await aiRes.json();
          summary = aiData.text || bodyText;
        } catch {
          summary = bodyText;
        }

        const msg: ChatMessage = {
          role: "assistant",
          content: summary,
          route,
        };
        const finalMsgs = [...messages, msg];
        setMessages(finalMsgs);
        debouncedSave(finalMsgs, conversationId);
      } catch {
        const errMsg: ChatMessage = { role: "assistant", content: "Nepodarilo sa prečítať email.", route };
        setMessages([...messages, errMsg]);
      } finally {
        setIsStreaming(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [messages, conversationId]
  );

  const sendMessage = useCallback(
    async (content: string) => {
      const userMsg: ChatMessage = { role: "user", content };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setIsStreaming(true);

      const ac = new AbortController();
      abortRef.current = ac;

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

      // If there's a pending calendar event, route follow-ups to calendar
      const hasPendingCalendar = messages.some(m => m.pendingCalendarEvent);
      if (hasPendingCalendar) {
        const calRoute: RouteResult = { type: "calendar", model: "gemini-2.5-flash", label: "Kalendár", icon: "📅" };
        setCurrentRoute(calRoute);
        try {
          await handleCalendarInChat(content, calRoute, updated, conversationId);
        } catch {
          calendarReply("Chyba pri spracovaní kalendára.", calRoute, updated, conversationId);
        } finally {
          setIsStreaming(false);
        }
        return;
      }

      // If last assistant message was calendar-related, keep routing to calendar
      const lastAssistantMsg = [...messages].reverse().find(m => m.role === "assistant");
      if (lastAssistantMsg?.calendarEvents && /ano|áno|ok|pridaj|potvrď|potvrd|zruš|zrus|zmen|zmeň|uprav|presuň|presun|yes|sure/i.test(lowerTrimmed)) {
        const calRoute: RouteResult = { type: "calendar", model: "gemini-2.5-flash", label: "Kalendár", icon: "📅" };
        setCurrentRoute(calRoute);
        try {
          await handleCalendarInChat(content, calRoute, updated, conversationId);
        } catch {
          calendarReply("Chyba pri spracovaní kalendára.", calRoute, updated, conversationId);
        } finally {
          setIsStreaming(false);
        }
        return;
      }

      // Handle "remember" / "zapamätaj si" — save to facts
      const rememberMatch = content.match(/^(?:zapam[aä]taj\s+si|remember|zapíš si|poznač si|ulož si do pamäte)[,:.]?\s*(.+)/i);
      if (rememberMatch) {
        const factText = rememberMatch[1].trim();
        const memRoute: RouteResult = { type: "text", model: "jalza", label: "Pamäť", icon: "🧠" };
        setCurrentRoute(memRoute);
        try {
          const res = await fetch("/api/facts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "add", fact: factText }),
          });
          const data = await res.json();
          const reply = data.status === "saved"
            ? `🧠 **Zapamätal som si:** ${factText}`
            : `❌ Nepodarilo sa uložiť: ${data.error || "neznáma chyba"}`;
          const msg: ChatMessage = { role: "assistant", content: reply, route: memRoute };
          const final = [...updated, msg];
          setMessages(final);
          debouncedSave(final, conversationId);
        } catch {
          setMessages([...updated, { role: "assistant", content: "❌ Chyba pri ukladaní do pamäte.", route: memRoute }]);
        } finally {
          setIsStreaming(false);
        }
        return;
      }

      // Cancel pending email only on clearly different topic
      if (pendingEmailRef.current && !/mail|email|posli|pošli|ano|ok|potvrd|potvrď|odosli|odošli|send|yes/i.test(lowerTrimmed)) {
        pendingEmailRef.current = null;
      }

      // Show thinking indicator while classify runs
      const thinkingMsg: ChatMessage = { role: "assistant", content: "" };
      setMessages([...updated, thinkingMsg]);

      let route = await detectRoute(
        content,
        !!activeAgent,
        activeAgent?.key,
        activeAgent?.name
      );

      const recentMessages = [...messages].reverse();
      const lastAssistant = recentMessages.find(m => m.role === "assistant");
      const lastUserWithImage = recentMessages.find(m => m.uploadedImage);
      const lastImage = lastAssistant?.generatedImage || lastUserWithImage?.uploadedImage || null;
      if (lastImage && route.type === "text") {
        route = { type: "image", model: "gemini-image", label: "Obrázok · edit", icon: "🎨" };
      }

      setCurrentRoute(route);

      // Update thinking indicator with route context
      const routeLoadingMsg: ChatMessage = { role: "assistant", content: "", route };
      setMessages([...updated, routeLoadingMsg]);

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

        if (route.type === "multi") {
          const multiMsg: ChatMessage = { role: "assistant", content: "🔗 **Multi-Agent** — dopytovanie všetkých znalostných agentov…", route };
          setMessages([...updated, multiMsg]);

          try {
            const res = await fetch("/api/multi-agent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ question: content }),
            });
            const data = await res.json();

            let summary = "";
            if (data.error) {
              summary = `❌ Chyba: ${data.error}`;
            } else if (data.results) {
              summary = `🔗 **Multi-Agent odpovede:**\n\n`;
              for (const [key, val] of Object.entries(data.results)) {
                const r = val as { agent: string; answer: string; sources: number; error?: string };
                summary += `### 📚 ${r.agent}\n`;
                if (r.error) {
                  summary += `_Chyba: ${r.error}_\n\n`;
                } else if (r.answer) {
                  summary += `${r.answer}\n\n`;
                } else {
                  summary += `_Žiadne relevantné informácie_\n\n`;
                }
              }
            }

            const resultMsg: ChatMessage = { role: "assistant", content: summary, route };
            const finalMsgs = [...updated, resultMsg];
            setMessages(finalMsgs);
            debouncedSave(finalMsgs, conversationId);
            trackUsage({ model: "jalza-multi", route: "multi", outputText: summary });
          } catch {
            setMessages([...updated, { role: "assistant", content: "❌ Multi-agent zlyhalo.", route }]);
          } finally {
            setIsStreaming(false);
          }
          return;
        }

        if (route.type === "business_action") {
          const actionMsg: ChatMessage = { role: "assistant", content: "🏗️ **Business Agent** — spracovávam požiadavku…\n\n_Hľadám produkty, vytváram projekt a cenovú ponuku…_", route };
          setMessages([...updated, actionMsg]);

          try {
            const res = await fetch("/api/business-agent", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prompt: content }),
            });
            const data = await res.json();

            let resultContent = "";
            if (data.error) {
              resultContent = `❌ **Chyba:** ${data.error}`;
            } else if (data.success) {
              resultContent = `✅ **Business Agent dokončený** (${data.total_steps || 0} krokov)\n\n${data.summary || ""}`;
              if (data.steps) {
                resultContent += "\n\n---\n**Kroky:**\n";
                for (const step of data.steps) {
                  const icon = step.status === "ok" ? "✅" : "❌";
                  resultContent += `${icon} ${step.tool}\n`;
                }
              }
            } else {
              resultContent = `⚠️ Agent nevrátil výsledok.`;
            }

            const resultMsg: ChatMessage = { role: "assistant", content: resultContent, route };
            const finalMsgs = [...updated, resultMsg];
            setMessages(finalMsgs);
            debouncedSave(finalMsgs, conversationId);
            trackUsage({ model: "gemini-2.5-flash", route: "business_action", outputText: resultContent });
          } catch {
            setMessages([...updated, { role: "assistant", content: "❌ Business agent zlyhал.", route }]);
          } finally {
            setIsStreaming(false);
          }
          return;
        }

        if (route.type === "business") {
          const bizMsg: ChatMessage = { role: "assistant", content: "🏢 **Business** — načítavam firemné dáta…", route };
          setMessages([...updated, bizMsg]);

          try {
            const summaryRes = await fetch("/api/business?action=summary");
            const summaryData = await summaryRes.json();

            if (summaryData.error) {
              setMessages([...updated, { role: "assistant", content: `❌ Chyba: ${summaryData.error}`, route }]);
              setIsStreaming(false);
              return;
            }

            const ctx = `Business dáta firmy:
- Aktívne zákazky: ${summaryData.orders?.active || 0} (hodnota: ${summaryData.orders?.totalValue?.toFixed(2) || 0}€)
- Návrhy zákaziek: ${summaryData.orders?.draft || 0}
- Dokončené: ${summaryData.orders?.completed || 0}
- Nové tento mesiac: ${summaryData.orders?.newThisMonth || 0}
- Nezaplatené vydané faktúry: ${summaryData.invoicesIssued?.unpaid?.toFixed(2) || 0}€
- Po splatnosti: ${summaryData.invoicesIssued?.overdue || 0}
- Mesačný obrat (zaplatené): ${summaryData.invoicesIssued?.monthRevenue?.toFixed(2) || 0}€
- Nezaplatené prijaté faktúry: ${summaryData.invoicesIncoming?.unpaid?.toFixed(2) || 0}€
Aktívne zákazky:
${(summaryData.activeOrders || []).map((o: any) => `  ${o.orderNumber} — ${o.name} (${o.customerName || "—"}) — ${o.totalValue?.toFixed(2) || 0}€`).join("\n")}`;

            const geminiRes = await fetch("/api/gemini", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: `Na základe firemných business dát odpovedz na otázku používateľa. Odpovedaj v slovenčine, stručne a prehľadne. Použi tabuľky alebo zoznamy ak je to vhodné.

${ctx}

Otázka: ${content}`,
              }),
            });
            const geminiData = await geminiRes.json();
            const answer = geminiData.text || geminiData.response || "Nepodarilo sa vygenerovať odpoveď.";

            const resultMsg: ChatMessage = { role: "assistant", content: `🏢 **Business prehľad:**\n\n${answer}`, route };
            const finalMsgs = [...updated, resultMsg];
            setMessages(finalMsgs);
            debouncedSave(finalMsgs, conversationId);
            trackUsage({ model: "gemini-2.5-flash", route: "business", outputText: answer });
          } catch {
            setMessages([...updated, { role: "assistant", content: "❌ Nepodarilo sa načítať business dáta.", route }]);
          } finally {
            setIsStreaming(false);
          }
          return;
        }

        if (route.type === "agent") {
          const agentMsg: ChatMessage = { role: "assistant", content: "🤖 **Agent spustený** — pracujem na úlohe krok po kroku…", route };
          setMessages([...updated, agentMsg]);

          try {
            const res = await fetch("/api/agent-task", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                prompt: content,
                agent: activeAgent?.key || "",
              }),
            });
            const data = await res.json();

            let summary = "";
            if (data.error) {
              summary = `❌ Agent chyba: ${data.error}`;
            } else {
              summary = `🤖 **Agent dokončený** (${data.total_steps} krokov)\n\n`;
              if (data.steps) {
                for (const step of data.steps) {
                  if (step.tool === "done") {
                    continue;
                  }
                  summary += `**Krok ${step.step}:**`;
                  if (step.thought) summary += ` _${step.thought.slice(0, 150)}_`;
                  summary += "\n";
                  if (step.tool) {
                    summary += `> \`${step.tool}\``;
                    if (step.input) summary += `: \`${step.input.slice(0, 100)}\``;
                    summary += "\n";
                  }
                  if (step.result) {
                    const res = step.result.length > 300 ? step.result.slice(0, 300) + "…" : step.result;
                    summary += `> ${res}\n`;
                  }
                  summary += "\n";
                }
              }
              if (data.final_answer) {
                summary += `---\n\n**Výsledok:**\n${data.final_answer}`;
              }
            }

            const resultMsg: ChatMessage = { role: "assistant", content: summary, route };
            const finalMsgs = [...updated, resultMsg];
            setMessages(finalMsgs);
            debouncedSave(finalMsgs, conversationId);
            trackUsage({ model: "jalza-agent", route: "agent", outputText: summary });
          } catch {
            const errMsg: ChatMessage = { role: "assistant", content: "❌ Agent task zlyhal. Skontroluj pripojenie k backendu.", route };
            setMessages([...updated, errMsg]);
          } finally {
            setIsStreaming(false);
          }
          return;
        }

        if (route.type === "research") {
          const researchMsg: ChatMessage = { role: "assistant", content: "Hľadám informácie na webe a ukladám do znalostnej databázy…", route };
          setMessages([...updated, researchMsg]);

          try {
            const agentKey = activeAgent?.key || "adsun_dopyty";
            const res = await fetch("/api/research", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ query: content, agent: agentKey }),
            });
            const data = await res.json();

            let summary = "";
            if (data.error && !data.results?.length) {
              summary = `Nepodarilo sa: ${data.error}`;
            } else {
              summary = `**Research dokončený** (agent: ${data.agent})\n\n`;
              summary += `Nájdených URL: ${data.total_urls} | Uložených: ${data.saved} | Chyby: ${data.failed}\n\n`;
              if (data.results) {
                for (const r of data.results) {
                  if (r.status === "ok") {
                    summary += `- **${r.title}** — ${r.url}\n`;
                  } else {
                    summary += `- ~~${r.url}~~ — ${r.error}\n`;
                  }
                }
              }
              if (data.analysis) {
                summary += `\n---\n\n**📊 Analýza:**\n\n${data.analysis}`;
              } else if (data.saved > 0) {
                summary += `\nDáta sú uložené. Teraz sa ma môžeš pýtať na tieto informácie.`;
              }
            }

            const resultMsg: ChatMessage = { role: "assistant", content: summary, route };
            const finalMsgs = [...updated, resultMsg];
            setMessages(finalMsgs);
            debouncedSave(finalMsgs, conversationId);
            trackUsage({ model: "gemini-research", route: "research", outputText: summary });
          } catch {
            const errMsg: ChatMessage = { role: "assistant", content: "Chyba pri research. Skontroluj pripojenie.", route };
            setMessages([...updated, errMsg]);
          } finally {
            setIsStreaming(false);
          }
          return;
        }

        if (route.type === "image") {
          const assistantMsg: ChatMessage = { role: "assistant", content: lastImage ? "Upravujem obrázok…" : "", route };
          const withAssistant = [...updated, assistantMsg];
          setMessages(withAssistant);

          try {
            const body: Record<string, unknown> = { prompt: content, useProxy: getFeatures().usProxy };
            if (lastImage) {
              body.image = lastImage;
            }
            const res = await fetch("/api/generate-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
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

          const searchMessages = [
            { role: "user" as const, content: `${context}\n\n${content}` },
          ];
          await streamResponse("/api/search", { messages: searchMessages }, route, updated, conversationId);
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
      const hasText = content.trim().length > 0;
      const isAnalysisQuestion = hasText && /^(čo|co|popíš|popis|analyzuj|analyse|analyze|describe|what|aké|ake|kde|kto|prečo|preco|koľko|kolko|je tu|vidíš|vidis|rozpoznaj)/i.test(content.trim());

      if (hasText && !isAnalysisQuestion) {
        const route: RouteResult = {
          type: "image",
          model: "gemini-image",
          label: "Obrázok · edit",
          icon: "🎨",
        };
        setCurrentRoute(route);

        const imageDataUrl = imageBase64.startsWith("data:")
          ? imageBase64
          : `data:image/jpeg;base64,${imageBase64}`;

        const userMsg: ChatMessage = { role: "user", content: `🎨 ${content}`, route, uploadedImage: imageDataUrl };
        const updated = [...messages, userMsg];
        setMessages(updated);
        setIsStreaming(true);

        const loadingMsg: ChatMessage = { role: "assistant", content: "Upravujem obrázok…", route };
        setMessages([...updated, loadingMsg]);

        try {

          const res = await fetch("/api/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: content, image: imageDataUrl, useProxy: getFeatures().usProxy }),
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
          } else {
            const errMsg: ChatMessage = {
              role: "assistant",
              content: data.error || "Nepodarilo sa upraviť obrázok.",
              route,
            };
            setMessages([...updated, errMsg]);
          }
        } catch {
          setMessages([...updated, { role: "assistant", content: "Chyba pri editovaní obrázku.", route }]);
        } finally {
          setIsStreaming(false);
        }
        return;
      }

      const route: RouteResult = {
        type: "text",
        model: "llama3.2-vision:11b",
        label: "Vision",
        icon: "👁",
      };
      setCurrentRoute(route);

      const displayContent = content || "Analyzuj tento obrázok";
      const visionDataUrl = imageBase64.startsWith("data:")
        ? imageBase64
        : `data:image/jpeg;base64,${imageBase64}`;
      const userMsg: ChatMessage = {
        role: "user",
        content: `📷 ${displayContent}`,
        route,
        uploadedImage: visionDataUrl,
      };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setIsStreaming(true);

      try {
        const rawBase64 = imageBase64.includes(",") ? imageBase64.split(",")[1] : imageBase64;
        await streamResponse(
          "/api/vision",
          { prompt: content, images: [rawBase64] },
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

  const stopGeneration = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const confirmCalendarEvent = useCallback(
    async (event: PendingCalendarEvent) => {
      const route: RouteResult = { type: "calendar", model: "gemini-2.5-flash", label: "Kalendár", icon: "📅" };

      const msgIdx = messages.findIndex(m => m.pendingCalendarEvent);
      if (msgIdx === -1) return;

      const updated = messages.map((m, i) =>
        i === msgIdx ? { ...m, pendingCalendarEvent: undefined, content: "⏳ Vytvárám udalosť..." } : m
      );
      setMessages(updated);
      setIsStreaming(true);

      const start = `${event.date}T${event.time}:00`;
      const endDate = new Date(new Date(start).getTime() + event.durationH * 3600000);
      const end = endDate.toISOString().slice(0, 19);

      try {
        const res = await fetch("/api/calendar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            subject: event.subject,
            start,
            end,
            location: event.location,
            body: event.body,
            attendees: event.attendees,
            account: "juraj",
          }),
        });
        const data = await res.json();
        if (data.error) {
          const errMsgs = updated.map((m, i) =>
            i === msgIdx ? { ...m, content: `**Chyba:** ${data.error}` } : m
          );
          setMessages(errMsgs);
        } else {
          const successContent = [
            `✅ **Udalosť vytvorená!**\n`,
            `📅 **${event.subject}**`,
            `🗓 ${event.date} (${event.dayName})`,
            `🕐 ${event.time} – ${event.endTime} (${event.durationH}h)`,
            event.location ? `📍 ${event.location}` : null,
            event.body ? `📝 ${event.body}` : null,
          ].filter(Boolean).join("\n");

          const successMsgs: ChatMessage[] = updated.map((m, i) =>
            i === msgIdx ? { ...m, content: successContent, route, calendarEvents: [data] } : m
          );
          setMessages(successMsgs);
          debouncedSave(successMsgs, conversationId);
        }
      } catch {
        const errMsgs = updated.map((m, i) =>
          i === msgIdx ? { ...m, content: "Nepodarilo sa vytvoriť udalosť." } : m
        );
        setMessages(errMsgs);
      } finally {
        setIsStreaming(false);
      }
    },
    [messages, conversationId, debouncedSave]
  );

  const cancelCalendarEvent = useCallback(() => {
    const updated = messages.map(m =>
      m.pendingCalendarEvent ? { ...m, pendingCalendarEvent: undefined, content: "❌ Vytvorenie zrušené." } : m
    );
    setMessages(updated);
  }, [messages]);

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
    readEmailById,
    stopGeneration,
    confirmCalendarEvent,
    cancelCalendarEvent,
  };
}
