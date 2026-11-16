// Vercel serverless function: /api/chat
// Keeps your Gemini API key secret on the server (never put the key in index.html).
// Setup: Vercel -> Project -> Settings -> Environment Variables -> GEMINI_API_KEY = your key
// Optional: GEMINI_MODEL (default below). Model names change over time, so keep it configurable.

const SYSTEM =
  "You are Xiters-AI, a friendly, funny chatbot on the personal website of Aasif (Prime Xiters), " +
  "a Class 11 student from Narela, Delhi who loves coding. Reply in the same language the user writes " +
  "(Hinglish or English) in at most 2-3 short sentences, with an emoji sometimes. Stay polite and clean: " +
  "no abuse, nothing sexual or violent. Never share anyone's phone number, address or other private details. " +
  "If you do not know something, say so honestly.";

const hits = new Map(); // best-effort rate limit per IP (resets when the function cold-starts)
function limited(ip) {
  const now = Date.now(), win = 60000, max = 15;
  const arr = (hits.get(ip) || []).filter((t) => now - t < win);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > max;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "Server is missing GEMINI_API_KEY" });

  // only allow requests coming from your own site
  const origin = req.headers.origin;
  if (origin && req.headers.host && !origin.includes(req.headers.host)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (limited(ip)) return res.status(429).json({ error: "Too many messages, slow down a bit." });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = null; } }
  const msgs = body && Array.isArray(body.messages) ? body.messages.slice(-8) : null;
  if (!msgs || !msgs.length) return res.status(400).json({ error: "messages required" });

  const contents = msgs
    .filter((m) => m && typeof m.content === "string" && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content.slice(0, 400) }] }));
  if (!contents.length || contents[contents.length - 1].role !== "user") {
    return res.status(400).json({ error: "last message must be from the user" });
  }

  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  try {
    const r = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: SYSTEM }] },
          contents,
          generationConfig: { maxOutputTokens: 300, temperature: 0.8 },
        }),
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data.error && data.error.message) || "AI error" });
    const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
    const reply = (parts || []).map((p) => p.text || "").join("").trim();
    if (!reply) return res.status(502).json({ error: "Empty reply" });
    return res.status(200).json({ reply });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach the AI" });
  }
};
    
