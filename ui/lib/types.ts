export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface Agent {
  key: string;
  name: string;
  description: string;
  sources: number;
  chunks: number;
  total_chars: number;
}

export interface Email {
  id?: string;
  sender: string;
  sender_email: string;
  subject: string;
  date: string;
  body: string;
}
