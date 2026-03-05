/**
 * Smart email parser for voice/STT input.
 * Uses a contacts database + fuzzy matching instead of LLM.
 */

export interface Contact {
  name: string;
  email: string;
  aliases: string[];
}

export interface ParsedEmail {
  to: string | null;
  subject: string | null;
  body: string | null;
  mailbox: string;
  missing: string[];
}

const CONTACTS: Contact[] = [
  {
    name: "Juraj Martinkovych",
    email: "juraj@adsun.sk",
    aliases: [
      "juraj", "jurajovi", "juro", "jurovi", "sam sebe", "sám sebe",
      "mne", "moj mail", "môj mail", "na mna", "na mňa", "sebe",
      "juraj adsun", "juraj adresu", "juraj@adresu",
      "juraj adresa", "martinkovych",
    ],
  },
  {
    name: "ADSUN info",
    email: "info@adsun.sk",
    aliases: [
      "info adsun", "info@adsun", "firemny mail", "firemný mail",
      "firma", "adsun info", "info adresu",
    ],
  },
  {
    name: "Juraj Chlepko",
    email: "juraj.chlepko@adsun.sk",
    aliases: [
      "chlepko", "chlepkovi", "riaditel", "riaditeľ", "riaditelovi",
    ],
  },
  {
    name: "Jozef Tomášek",
    email: "jozef.tomasek@adsun.sk",
    aliases: [
      "tomasek", "tomášek", "tomáškovi", "jozef", "jožko", "jozo",
      "inovacie", "inovácie",
    ],
  },
  {
    name: "Simona Jurčíková",
    email: "simona.jurcikova@adsun.sk",
    aliases: [
      "simona", "simone", "jurcikova", "jurčíková", "jurcikovej",
      "uctovnictvo", "účtovníctvo", "uctovnicka", "účtovníčka",
    ],
  },
  {
    name: "Myška",
    email: "myska@adsun.sk",
    aliases: ["myska", "myška", "myške", "graficka", "grafička", "grafike"],
  },
  {
    name: "Matej Šejc",
    email: "matej.sejc@adsun.sk",
    aliases: [
      "matej", "sejc", "šejc", "obchodnik", "obchodník", "obchodníkovi",
    ],
  },
];

const STT_CORRECTIONS: [RegExp, string][] = [
  [/adresu[\.\s]*sk/gi, "adsun.sk"],
  [/adresa[\.\s]*sk/gi, "adsun.sk"],
  [/at\s*sign/gi, "@"],
  [/zavinac/gi, "@"],
  [/zavináč/gi, "@"],
  [/bodka/gi, "."],
  [/slnko/gi, ""],    // common STT garbage
  [/ano\s*je/gi, ""],  // filler
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function correctSTT(text: string): string {
  let result = text;
  for (const [pattern, replacement] of STT_CORRECTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function findContact(text: string): Contact | null {
  const corrected = correctSTT(text);
  const norm = normalize(corrected);

  // Direct email match
  const emailMatch = corrected.match(/[\w.-]+@[\w.-]+\.\w+/);
  if (emailMatch) {
    const found = CONTACTS.find((c) => c.email === emailMatch[0]);
    if (found) return found;
    return { name: emailMatch[0], email: emailMatch[0], aliases: [] };
  }

  // Try to reconstruct email from "name @ domain" patterns
  const atPattern = corrected.match(/([\w.-]+)\s*@\s*([\w.-]+)/);
  if (atPattern) {
    const reconstructed = `${atPattern[1]}@${atPattern[2]}`;
    const emailLike = reconstructed.includes(".") ? reconstructed : `${reconstructed}.sk`;
    const found = CONTACTS.find(
      (c) => normalize(c.email) === normalize(emailLike)
    );
    if (found) return found;
    return { name: emailLike, email: emailLike, aliases: [] };
  }

  // Alias matching — longest match first
  const sortedContacts = [...CONTACTS].sort(
    (a, b) =>
      Math.max(...b.aliases.map((al) => al.length)) -
      Math.max(...a.aliases.map((al) => al.length))
  );

  for (const contact of sortedContacts) {
    for (const alias of contact.aliases) {
      if (norm.includes(normalize(alias))) {
        return contact;
      }
    }
  }

  return null;
}

const SUBJECT_MARKERS = [
  /predmet\s*(?:bude|je|:)?\s*(.+?)(?:\s*(?:,|\.|\ba\b|text|obsah|body|sprava|správa|telo))/i,
  /predmet\s*(?:bude|je|:)?\s*(.+?)$/i,
  /s\s*(?:tym|tým)\s*(?:ze|že)\s*(?:predmet\s*)?(.+?)(?:\s*(?:,|\.|\ba\b|text|obsah|telo))/i,
  /subject\s*(?:is|:)?\s*(.+?)(?:\s*(?:,|\.|\ba\b|body|text))/i,
];

const BODY_MARKERS = [
  /(?:obsah|text|body|sprava|správa|telo)\s*(?:bude|je|:| mailu| emailu)?\s*(.+)/i,
  /(?:s\s*textom|s\s*obsahom)\s+(.+)/i,
  /(?:aha|a)\s+(?:obsah|text)\s*(?:bude|je|:)?\s*(.+)/i,
  /(?:ze|že)\s+(?:tex|text)\s+(?:bude)?\s*(.+?)(?:\s+(?:aha|a|obsah))/i,
];

export function parseEmailCommand(text: string): ParsedEmail {
  const corrected = correctSTT(text);
  const missing: string[] = [];

  // Find recipient
  const contact = findContact(corrected);
  const to = contact?.email || null;
  if (!to) missing.push("adresa príjemcu");

  // Find subject
  let subject: string | null = null;
  for (const pattern of SUBJECT_MARKERS) {
    const m = corrected.match(pattern);
    if (m) {
      subject = m[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }

  // Find body
  let body: string | null = null;
  for (const pattern of BODY_MARKERS) {
    const m = corrected.match(pattern);
    if (m) {
      body = m[1].trim().replace(/^["']|["']$/g, "");
      break;
    }
  }

  // Fallback: if we have "test" in the text but no subject, use it
  if (!subject) {
    const testMatch = corrected.match(/(?:^|\s)test(?:\s|$)/i);
    if (testMatch) subject = "Test";
  }
  if (!subject) missing.push("predmet");

  // Fallback: everything after subject/recipient could be the body
  if (!body && subject) {
    const afterSubject = corrected.split(subject).pop()?.trim();
    if (afterSubject && afterSubject.length > 5) {
      body = afterSubject
        .replace(/^[\s,.\-a]+/, "")
        .replace(/^(?:aha|a)\s+/, "")
        .replace(/^(?:obsah|text|body)\s*(?:bude|je|:)?\s*/i, "")
        .trim();
    }
  }
  if (!body) {
    body = subject ? `${subject}` : null;
    if (!body) missing.push("text emailu");
  }

  // Detect mailbox
  const lower = corrected.toLowerCase();
  let mailbox = "personal";
  if (/info@adsun|firemn|firma/.test(lower)) mailbox = "adsun";
  else if (/juraj@adsun|juraj\s*adsun|pracovn/.test(lower)) mailbox = "juraj";

  return { to, subject, body, mailbox, missing };
}

export function getContacts(): Contact[] {
  return CONTACTS;
}

export function addContact(contact: Contact): void {
  CONTACTS.push(contact);
}
