const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-2.0-flash": { input: 0.10 / 1_000_000, output: 0.40 / 1_000_000 },
  "gemini-2.5-flash-preview-05-20": { input: 0.15 / 1_000_000, output: 3.50 / 1_000_000 },
  "gemini-2.5-pro-preview-05-06": { input: 1.25 / 1_000_000, output: 10.00 / 1_000_000 },
  "jalza": { input: 0, output: 0 },
  "qwen2.5:72b": { input: 0, output: 0 },
  "llama3.2-vision:11b": { input: 0, output: 0 },
  "nomic-embed-text": { input: 0, output: 0 },
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

function getProvider(model: string): string {
  if (model.startsWith("gemini")) return "gemini";
  return "ollama";
}

function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return inputTokens * price.input + outputTokens * price.output;
}

export async function trackUsage(params: {
  model: string;
  route: string;
  inputText?: string;
  outputText?: string;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  const inputTokens = params.inputTokens || estimateTokens(params.inputText || "");
  const outputTokens = params.outputTokens || estimateTokens(params.outputText || "");
  const provider = getProvider(params.model);
  const costUsd = calculateCost(params.model, inputTokens, outputTokens);

  try {
    await fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "log",
        model: params.model,
        provider,
        route: params.route,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: costUsd,
      }),
    });
  } catch {
    // non-blocking
  }
}

export interface UsageSummary {
  period: string;
  since: string;
  totals: {
    requests: number;
    total_input: number;
    total_output: number;
    total_cost: number;
  };
  by_model: Array<{
    model: string;
    provider: string;
    requests: number;
    total_input: number;
    total_output: number;
    total_cost: number;
  }>;
  daily: Array<{
    model: string;
    provider: string;
    route: string;
    requests: number;
    total_input: number;
    total_output: number;
    total_cost: number;
    day: string;
  }>;
}

export async function getUsageSummary(period: "day" | "week" | "month" = "month"): Promise<UsageSummary | null> {
  try {
    const res = await fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "summary", period }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
