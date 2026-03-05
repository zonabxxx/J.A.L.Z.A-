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

export interface ChatMessage extends Message {
  route?: RouteResult;
}

export function useChat(activeAgent: Agent | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentRoute, setCurrentRoute] = useState<RouteResult | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

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
  };

  const emailReply = (
    text: string,
    route: RouteResult,
    msgs: ChatMessage[],
    convId: string | null
  ) => {
    const finalMsgs: ChatMessage[] = [...msgs, { role: "assistant", content: text, route }];
    setMessages(finalMsgs);
    debouncedSave(finalMsgs, convId);
  };

  const detectMailbox = (text: string): string => {
    const l = text.toLowerCase();
    if (/adsun|info@adsun|firemn|firma/.test(l)) return "adsun";
    if (/juraj@|juraj\s*adsun|moj\s*pracovn/.test(l)) return "juraj";
    return "personal";
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const formatEmailList = (emails: any[]): string => {
    if (!emails || emails.length === 0) return "";
    return emails
      .map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any, i: number) =>
          `${i + 1}. **Od:** ${e.from || e.sender?.emailAddress?.address || "?"}\n` +
          `   **Predmet:** ${e.subject}\n` +
          `   **Dátum:** ${e.date || e.receivedDateTime || "?"}\n` +
          `   ${e.snippet || e.bodyPreview ? `**Náhľad:** ${(e.snippet || e.bodyPreview || "").slice(0, 150)}` : ""}`
      )
      .join("\n\n");
  };

  const handleEmailInChat = async (
    userText: string,
    route: RouteResult,
    updatedMessages: ChatMessage[],
    convId: string | null
  ) => {
    const lower = userText.toLowerCase();
    const mailbox = detectMailbox(userText);

    const isSend = /posli|pošli|odosli|odošli|napisz|napíš|send|write\s*mail|write\s*email/i.test(lower);
    const isReply = /odpoved|odpovedz|reply|reaguj/i.test(lower);
    const isSearch = /hladaj|hľadaj|najdi|nájdi|search|vyhladaj|vyhľadaj|od\s+\w+.*mail|mail.*od\s+\w+/i.test(lower);
    const isCleanupExec = /vymaz\s*(ich|to|ich\s*vsetk|všetk)|zmaz\s*(ich|to)|delete\s*them|potvrdzujem/i.test(lower);
    const isCleanup = /vymaz|vymaž|zmaz|zmaž|cleanup|spam|marketing|upratat|upratať|vycisti|vyčisti/i.test(lower) && !isSend && !isCleanupExec;
    const isRead = /precitaj|prečítaj|otvor|read|zobraz.*detail|celý\s*mail|cely\s*mail/i.test(lower);

    // ── SEND EMAIL ──
    if (isSend && !isReply) {
      const classifyPrompt = `Si emailový asistent. Používateľ ti HOVORÍ hlasom — text je zo speech-to-text a môže byť skomolený/chybný. Musíš pochopiť ZÁMER.

ZNÁME KONTAKTY A ADRESY:
- Juraj Martinkovych (vlastník) = juraj@adsun.sk
- ADSUN s.r.o. (firma) = info@adsun.sk
- "sám sebe" / "mne" / "na moj mail" = juraj@adsun.sk
- Juraj Chlepko (riaditeľ) = riaditeľ ADSUN
- Jozef Tomášek (inovácie), Simona Jurčíková (účtovníctvo), Myška (grafička), Matej Šejc (obchodník)

TYPICKÉ STT CHYBY (rozpoznaj ich):
- "adresu sk" / "adresa sk" / "adresu.sk" → adsun.sk
- "at sign" / "zavináč" / "@" / "na" (v kontexte emailu) → @
- "juraj adresu sk" → juraj@adsun.sk
- "info adresu sk" → info@adsun.sk
- "sam sebe" / "sám sebe" / "na moj mail" → juraj@adsun.sk
- "slnko" ak nedáva zmysel → pravdepodobne STT chyba, ignoruj

ÚLOHA: Extrahuj z textu:
1. to (emailová adresa) — použi známe kontakty ak rozpoznáš meno
2. subject (predmet emailu)
3. body (text emailu)

VŽDY odpovedz IBA JSON, nič iné:
{"action":"send","to":"email@example.com","subject":"Predmet","body":"Text emailu"}

Ak naozaj nevieš komu, napíš: {"action":"ask","question":"Na akú adresu mám email poslať?"}`;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: classifyPrompt },
            { role: "user", content: userText },
          ],
        }),
      });

      if (res.ok) {
        const reader = res.body?.getReader();
        if (!reader) return;
        const decoder = new TextDecoder();
        let fullText = "";
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const p = line.slice(6);
              if (p === "[DONE]") continue;
              try { const d = JSON.parse(p); if (d.content) fullText += d.content; } catch {}
            }
          }
        }

        const jsonMatch = fullText.match(/\{[\s\S]*?"action"\s*:\s*"(send|ask)"[\s\S]*?\}/);
        if (jsonMatch) {
          try {
            const cmd = JSON.parse(jsonMatch[0]);
            if (cmd.action === "ask") {
              emailReply(cmd.question || "Na akú adresu mám email poslať?", route, updatedMessages, convId);
              return;
            }
            const sendRes = await fetch("/api/email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: "send",
                mailbox: cmd.mailbox || mailbox,
                to: cmd.to,
                subject: cmd.subject,
                body: cmd.body,
              }),
            });
            const sendData = await sendRes.json();
            if (sendData.status === "sent") {
              emailReply(`**Email odoslaný!**\n- **Komu:** ${cmd.to}\n- **Predmet:** ${cmd.subject}\n- **Text:** ${cmd.body}`, route, updatedMessages, convId);
            } else {
              emailReply(`Chyba pri odoslaní: ${sendData.error || "neznáma chyba"}`, route, updatedMessages, convId);
            }
          } catch {
            emailReply("Nepodarilo sa spracovať emailový príkaz. Skús to znova jasnejšie.", route, updatedMessages, convId);
          }
        } else {
          emailReply(fullText || "Nepodarilo sa rozpoznať emailový príkaz. Povedz napr.: 'Pošli mail na juraj@adsun.sk, predmet Test, text Ahoj toto je test.'", route, updatedMessages, convId);
        }
      }
      return;
    }

    // ── SEARCH EMAILS ──
    if (isSearch) {
      const queryMatch = lower.match(/(?:hladaj|hľadaj|najdi|nájdi|search|vyhladaj|vyhľadaj)\s+(.+)/i)
        || lower.match(/mail.*od\s+(.+)/i)
        || lower.match(/od\s+(.+?)(?:\s*mail|\s*$)/i);
      const query = queryMatch?.[1]?.trim() || userText;

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

        const emailContext = formatEmailList(emails);
        const systemPrompt = `Si emailový asistent. Výsledky vyhľadávania emailov pre "${query}":\n\n${emailContext}\n\nZhrň výsledky prehľadne po slovensky.`;

        await streamResponse(
          "/api/chat",
          { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }] },
          route, updatedMessages, convId
        );
      } catch {
        emailReply("Nepodarilo sa vyhľadať emaily.", route, updatedMessages, convId);
      }
      return;
    }

    // ── CLEANUP EXECUTE ──
    if (isCleanupExec) {
      try {
        const res = await fetch("/api/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cleanup_execute" }),
        });
        const data = await res.json();
        emailReply(
          `**Cleanup dokončený!**\n- Vymazaných marketing emailov: ${data.marketing_deleted || data.marketing_found || 0}\n- Vymazaných starých emailov: ${data.old_deleted || data.old_found || 0}\n- Celkom vymazaných: ${data.deleted || 0}`,
          route, updatedMessages, convId
        );
      } catch {
        emailReply("Nepodarilo sa vymazať emaily.", route, updatedMessages, convId);
      }
      return;
    }

    // ── CLEANUP PREVIEW ──
    if (isCleanup) {
      try {
        const res = await fetch("/api/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "cleanup", dry_run: true }),
        });
        const data = await res.json();
        emailReply(
          `**Cleanup analýza (náhľad):**\n- Marketing emaily na zmazanie: **${data.marketing_found || 0}**\n- Staré emaily (365+ dní): **${data.old_found || 0}**\n\nAk chceš tieto emaily **naozaj vymazať**, napíš: "**vymaz ich**"`,
          route, updatedMessages, convId
        );
      } catch {
        emailReply("Nepodarilo sa analyzovať emaily na cleanup.", route, updatedMessages, convId);
      }
      return;
    }

    // ── READ SPECIFIC EMAIL ──
    if (isRead) {
      const numMatch = lower.match(/(?:precitaj|prečítaj|otvor|zobraz)\s*(?:mail|email)?\s*(?:číslo|cislo|č\.|c\.)?\s*(\d+)/i);
      if (numMatch) {
        const idx = parseInt(numMatch[1]) - 1;
        const listRes = await fetch(`/api/email?mailbox=${mailbox}&limit=20`);
        const listData = await listRes.json();
        const emails = listData.emails || [];
        const target = emails[idx];
        if (target && target.id) {
          try {
            const readRes = await fetch("/api/email", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "read", mailbox, id: target.id }),
            });
            const detail = await readRes.json();
            const body = detail.body?.content || detail.body || detail.snippet || "Bez obsahu";
            emailReply(
              `**Od:** ${target.from || target.sender?.emailAddress?.address}\n**Predmet:** ${target.subject}\n**Dátum:** ${target.date || target.receivedDateTime}\n\n---\n\n${body}`,
              route, updatedMessages, convId
            );
          } catch {
            emailReply("Nepodarilo sa prečítať email.", route, updatedMessages, convId);
          }
          return;
        }
      }
    }

    // ── DEFAULT: FETCH & SUMMARIZE ──
    try {
      const todayCheck = /dnes|today|dnesn/i.test(lower);
      const allMailboxes = /vsetk|všetk|obe|obidv|all/i.test(lower);

      type EmailEntry = { from?: string; subject?: string; date?: string; receivedDateTime?: string; snippet?: string; bodyPreview?: string; sender?: { emailAddress?: { address?: string } } };
      let allEmails: EmailEntry[] = [];

      if (allMailboxes) {
        const [r1, r2, r3] = await Promise.all([
          fetch(`/api/email?today=${todayCheck}&limit=10&mailbox=personal`).then(r => r.json()),
          fetch(`/api/email?today=${todayCheck}&limit=10&mailbox=adsun`).then(r => r.json()),
          fetch(`/api/email?today=${todayCheck}&limit=10&mailbox=juraj`).then(r => r.json()),
        ]);
        if (r1.emails) allEmails.push(...r1.emails.map((e: EmailEntry) => ({ ...e, _box: "osobný" })));
        if (r2.emails) allEmails.push(...r2.emails.map((e: EmailEntry) => ({ ...e, _box: "info@adsun.sk" })));
        if (r3.emails) allEmails.push(...r3.emails.map((e: EmailEntry) => ({ ...e, _box: "juraj@adsun.sk" })));
      } else {
        const res = await fetch(`/api/email?today=${todayCheck}&limit=20&mailbox=${mailbox}`);
        const data = await res.json();
        if (data.error) {
          emailReply(`Chyba pri načítaní emailov: ${data.error}`, route, updatedMessages, convId);
          return;
        }
        allEmails = data.emails || [];
      }

      if (allEmails.length === 0) {
        emailReply(
          todayCheck ? "Dnes nemáš žiadne nové emaily." : "Nemáš žiadne neprečítané emaily.",
          route, updatedMessages, convId
        );
        return;
      }

      const emailContext = formatEmailList(allEmails);
      const mailboxLabel = mailbox === "adsun" ? "info@adsun.sk" : mailbox === "juraj" ? "juraj@adsun.sk" : "osobná schránka";

      const systemPrompt = `Si emailový asistent J.A.L.Z.A. Schránka: ${allMailboxes ? "všetky" : mailboxLabel}.
Tu sú emaily:\n\n${emailContext}\n\n
Odpovedz stručne po slovensky. Zhrň emaily prehľadne, použi čísla a tučné písmo pre mená/predmety.
Na konci pripomeň: "Môžeš povedať: 'prečítaj mail 3', 'odpovedz na mail 1', 'pošli mail na...', 'hľadaj maily od...', 'vymaž spam'"`;

      await streamResponse(
        "/api/chat",
        { messages: [{ role: "system", content: systemPrompt }, { role: "user", content: userText }] },
        route, updatedMessages, convId
      );
    } catch {
      emailReply("Nepodarilo sa načítať emaily. Skontroluj pripojenie.", route, updatedMessages, convId);
    }
  };

  const sendMessage = useCallback(
    async (content: string) => {
      const userMsg: ChatMessage = { role: "user", content };
      const updated = [...messages, userMsg];
      setMessages(updated);
      setIsStreaming(true);

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
  };
}
