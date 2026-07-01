// Talks to Groq's free, OpenAI-compatible chat completions endpoint.
// Mirrors the retry/backoff logic from the desktop tool: free tiers enforce a
// requests/tokens-per-minute cap, and a plain fetch() would just crash on a
// 429. Here we retry with backoff (honoring Retry-After when present) so a
// batch run recovers instead of failing outright.

const BASE_URL = "https://api.groq.com/openai/v1";
const MAX_RETRIES = 6;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function post(payload: Record<string, unknown>): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not set in your environment variables.");

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const resp = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (resp.status === 429 || resp.status >= 500) {
      const retryAfter = resp.headers.get("retry-after");
      const wait = retryAfter ? parseFloat(retryAfter) * 1000 : Math.min(2 ** attempt, 20) * 1000;
      if (attempt < MAX_RETRIES) {
        await sleep(wait);
        continue;
      }
    }

    if (!resp.ok) {
      let detail = resp.statusText;
      try {
        const body = await resp.json();
        detail = body?.error?.message || JSON.stringify(body);
      } catch {
        /* ignore parse failure, use statusText */
      }
      throw new Error(`Groq API error ${resp.status}: ${detail}`);
    }
    return resp.json();
  }
  throw new Error("Groq API: exhausted retries.");
}

export async function completeText(
  model: string,
  system: string,
  prompt: string,
  maxTokens = 1200
): Promise<string> {
  const data = await post({
    model,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  return data.choices?.[0]?.message?.content ?? "";
}

export async function completeJSON<T = any>(
  model: string,
  system: string,
  prompt: string,
  maxTokens = 1200
): Promise<T> {
  const sysJson = system + "\n\nRespond with valid JSON only — no prose, no code fences.";
  const text = await completeText(model, sysJson, prompt, maxTokens);
  return extractJSON(text);
}

function extractJSON(text: string): any {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
    if (m) return JSON.parse(m[1]);
    throw new Error(`Could not parse JSON from model output: ${text.slice(0, 200)}`);
  }
}
