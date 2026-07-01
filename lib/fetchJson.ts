// Reads a fetch Response safely: never throws on an empty or non-JSON body
// (which is what a serverless crash or timeout often returns), and always
// gives back a real error message on failure instead of a cryptic parse error.
export async function readJsonSafely(r: Response): Promise<any> {
  const text = await r.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    // Not JSON — likely an HTML error page from a crash. Surface a snippet
    // of it so the error is at least readable instead of a blank crash.
    return { error: text.slice(0, 300) };
  }
}

export async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init);
  const data = await readJsonSafely(r);
  if (!r.ok) {
    throw new Error(data.error || `Request to ${url} failed (HTTP ${r.status}).`);
  }
  return data;
}
