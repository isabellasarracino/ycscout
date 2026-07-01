"use client";

import { useState } from "react";
import { fetchJson } from "@/lib/fetchJson";

interface Msg { role: "user" | "bot"; text: string }

export default function AskPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    try {
      const data = await fetchJson("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      setMessages((m) => [...m, { role: "bot", text: data.answer }]);
    } catch (err: any) {
      setMessages((m) => [...m, { role: "bot", text: `Error: ${err.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1>Ask</h1>
      <div className="meta">
        Ask about a specific batch (e.g. "fall-2026" or "Summer 2024") or a company by name.
        This app doesn't have live web access, so it can't look up funding or news.
      </div>

      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.text}</div>
        ))}
        {loading && <div className="msg bot">Thinking…</div>}
      </div>

      <form className="ask-form" onSubmit={send}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Which fall-2026 companies were flagged?"
          disabled={loading}
        />
        <button type="submit" disabled={loading}>Send</button>
      </form>
    </div>
  );
}
