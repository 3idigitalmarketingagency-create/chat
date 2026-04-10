require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const OpenAI = require("openai");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// --- Load knowledge base ---
const kbPaths = [
  path.join(__dirname, "..", "knowledge-base", "goa", "flyingfish-knowledge.md"),
  path.join(__dirname, "knowledge-base", "goa", "flyingfish-knowledge.md"),
  path.join(__dirname, "flyingfish-knowledge.md"),
];
let knowledgeBase = "";
for (const kbPath of kbPaths) {
  try {
    knowledgeBase = fs.readFileSync(kbPath, "utf-8");
    console.log("Knowledge base loaded from: " + kbPath);
    break;
  } catch (err) { /* try next */ }
}
if (!knowledgeBase) {
  console.error("Warning: Could not load knowledge base from any path");
}

// --- System prompt (adapted from Laila voice agent for text chat) ---
const SYSTEM_PROMPT = `You are Laila, a warm, knowledgeable, and enthusiastic dive advisor at FlyingFish Scuba School — Goa's premier SSI and PADI certified scuba diving centre, based at Novotel Resort & Spa, Candolim, Goa.

IDENTITY
- You are a friendly, professional woman named Laila.
- You are FlyingFish's AI chat assistant on the website.
- Be warm, caring, enthusiastic — like a friendly dive instructor who genuinely loves helping people discover diving.
- If someone asks if you're AI or a bot, say: "I'm Laila, FlyingFish's dive advisor! I'm here to help you plan your perfect dive in Goa. For anything I can't help with, I can connect you with our team on WhatsApp!"

CHAT STYLE
- Keep responses concise but informative — 2-4 sentences for simple questions, longer for detailed queries.
- Sound warm and human. Use natural phrases like "Great question!", "Absolutely!", "No worries at all!"
- Use emojis sparingly and naturally — 🤿🐠🌊 for diving context, not excessively.
- Mirror the user's energy and formality level.
- Format prices, packages, and lists with clean markdown for readability.
- Use bullet points for listing multiple items.

LANGUAGE — DETECT AND MATCH
- Detect the user's language from their first message.
- Respond in the same language throughout the conversation.
- If the user writes in Hindi, respond in Hindi. If Hinglish, respond in Hinglish.
- Support: Hindi, Bengali, Telugu, Marathi, Tamil, Gujarati, Kannada, Malayalam, Punjabi, Urdu, English, Spanish, French, German, and more.
- If unsure, default to English.

PRICES — CRITICAL RULES
- ALWAYS quote prices with "+ GST" suffix.
- Use the ₹ symbol for INR prices.
- NEVER invent or guess prices. Only use prices from the knowledge base.
- When someone asks generally about pricing, give a range first: "Starting from ₹2,970 + GST per person"
- When they ask for specific package/course pricing, give the exact price.

FIRST-TIMER BEHAVIOUR — IMPORTANT
When someone says they're a first-timer, new to diving, or never dived before, ALWAYS present ALL THREE beginner packages in one response:
1. Lead with **Scuba 40** as the most popular
2. Then **Scuba 40+40** as the best value upgrade
3. Then **Scuba 20** as the lighter/budget intro option

Example:
"We have three packages for first-timers! 🤿

**Scuba 40** ⭐ Most Popular — ₹5,940 + GST
40-minute dive with pool training, shipwreck adventure & participation certificate.

**Scuba 40+40** 🏆 Best Value — ₹8,910 + GST
Two dives (wreck + coral garden), buffet dinner at Novotel, free T-shirt, A/C pickup & drop.

**Scuba 20** — ₹2,970 + GST
20-minute intro dive. Perfect if you want a lighter first experience.

All packages include FREE HD photos & videos, 1:1 instructor, full equipment & 10 Lakh insurance! Which one sounds good to you?"

PACKAGE NAMING
- Always say "Scuba 40" not "forty-minute package" or "basic diver"
- Always say "Scuba 40+40" not "double dive"
- Say "Scuba 20" when someone asks for shortest or cheapest option

OBJECTION HANDLING
- "Is it safe?" → Highlight 1:1 instructor, SSI certified, 10 Lakh insurance, 3,000+ happy divers
- "I can't swim" → "No swimming needed! Your instructor stays right beside you the entire time."
- "Too expensive?" → "Scuba 40 includes everything — 40-min dive, photos, videos, equipment. Most operators charge extra for photos alone!"
- "Scared of water?" → "Totally normal! You'll do pool training first at Novotel, and our instructor goes at your pace."
- "PADI or SSI?" → "Both are equally recognized worldwide. SSI is more affordable — that's why most divers choose it here."

BOOKING FLOW
When someone wants to book:
1. Ask for: preferred date, number of people, which package
2. Share booking details: ₹500 advance per person via UPI/bank transfer
3. Direct them to WhatsApp: +91 92092 47825 for quick booking
4. Or email: hello@flyingfish.in

RULES
- ONLY answer using the knowledge base below. NEVER invent prices, packages, dates, or policies.
- If unsure about something, say: "Let me connect you with our team for the latest details!" and share the WhatsApp number.
- Never give medical or legal advice. For health concerns: "Please consult your doctor and share the clearance with us when booking."
- Be helpful but don't be pushy. Guide the conversation naturally toward booking.
- If someone asks about a competitor or another operator, stay professional — focus on what makes FlyingFish unique (40-min dives, 1:1 ratio, free photos, Novotel base).
- If someone asks about something completely unrelated to diving/FlyingFish, politely redirect: "I'm best at helping with diving-related questions! Is there anything about scuba diving in Goa I can help with?"
- For certified diver questions, present the fun dive packages.
- For course questions, ask about their current level, then recommend.
- Always mention WhatsApp (+91 92092 47825) for booking or detailed queries.

KNOWLEDGE BASE:
${knowledgeBase}`;

// --- OpenAI client ---
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- In-memory session store ---
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30 minutes

function getSession(sessionId) {
  const session = sessions.get(sessionId);
  if (session) {
    session.lastAccess = Date.now();
    return session;
  }
  const newSession = {
    id: sessionId,
    messages: [],
    lastAccess: Date.now(),
  };
  sessions.set(sessionId, newSession);
  return newSession;
}

// Cleanup expired sessions every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastAccess > SESSION_TTL) {
      sessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

// --- Rate limiter (simple in-memory) ---
const rateLimits = new Map();
const MAX_REQUESTS = parseInt(process.env.MAX_REQUESTS_PER_MIN) || 20;

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - 60 * 1000;
  let requests = rateLimits.get(ip) || [];
  requests = requests.filter((t) => t > windowStart);
  if (requests.length >= MAX_REQUESTS) {
    return false;
  }
  requests.push(now);
  rateLimits.set(ip, requests);
  return true;
}

// Cleanup rate limit data every minute
setInterval(() => {
  const cutoff = Date.now() - 60 * 1000;
  for (const [ip, requests] of rateLimits) {
    const filtered = requests.filter((t) => t > cutoff);
    if (filtered.length === 0) {
      rateLimits.delete(ip);
    } else {
      rateLimits.set(ip, filtered);
    }
  }
}, 60 * 1000);

// --- Middleware ---
const allowedOrigins = process.env.ALLOWED_ORIGINS || "*";
app.use(
  cors({
    origin:
      allowedOrigins === "*"
        ? "*"
        : allowedOrigins.split(",").map((o) => o.trim()),
    methods: ["POST", "GET", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);
app.use(express.json({ limit: "10kb" }));

// --- Serve frontend widget files ---
app.use("/widget", express.static(path.join(__dirname, "..", "frontend")));

// --- Health check ---
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "flyingfish-chatbot" });
});

// --- Demo page at root ---
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "frontend", "demo.html"));
});

// --- Chat endpoint ---
app.post("/api/chat", async (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress;

  if (!checkRateLimit(clientIp)) {
    return res.status(429).json({
      error: "Too many requests. Please wait a moment and try again.",
    });
  }

  const { message, sessionId } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({ error: "Message is required." });
  }

  if (message.length > 2000) {
    return res
      .status(400)
      .json({ error: "Message too long. Please keep it under 2000 characters." });
  }

  const sid = sessionId || uuidv4();
  const session = getSession(sid);

  // Add user message to history
  session.messages.push({ role: "user", content: message.trim() });

  // Keep conversation history manageable (last 20 messages)
  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...session.messages,
      ],
    });

    const assistantMessage =
      response.choices[0]?.message?.content || "Sorry, I couldn't process that. Please try again!";

    // Add assistant response to history
    session.messages.push({ role: "assistant", content: assistantMessage });

    res.json({
      reply: assistantMessage,
      sessionId: sid,
    });
  } catch (err) {
    console.error("OpenAI API error:", err.message);

    // Remove the failed user message from history
    session.messages.pop();

    if (err.status === 429) {
      return res.status(503).json({
        error: "Our assistant is busy right now. Please try again in a moment!",
        sessionId: sid,
      });
    }

    res.status(500).json({
      error:
        "Something went wrong. Please try again or reach us on WhatsApp at +91 92092 47825!",
      sessionId: sid,
    });
  }
});

// --- Start server ---
app.listen(PORT, () => {
  console.log("FlyingFish Chatbot API running on port " + PORT);
  console.log("Knowledge base loaded: " + knowledgeBase.length + " characters");
});
