process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});

require("dotenv").config({ path: require("path").join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;

// --- Load structured knowledge base ---
const knowledgeDir = path.join(__dirname, "knowledge");

let flyingfishData = {};
let coursesData = {};
let adventuresData = {};

try {
  flyingfishData = JSON.parse(fs.readFileSync(path.join(knowledgeDir, "flyingfish.json"), "utf-8"));
  console.log("FlyingFish general knowledge loaded");
} catch (err) {
  console.error("Failed to load flyingfish.json:", err.message);
}

try {
  coursesData = JSON.parse(fs.readFileSync(path.join(knowledgeDir, "courses.json"), "utf-8"));
  console.log("Courses knowledge loaded:", Object.keys(coursesData.courses || {}).length, "courses,",
    Object.keys(coursesData.ecology?.programs || {}).length, "ecology programs");
} catch (err) {
  console.error("Failed to load courses.json:", err.message);
}

try {
  adventuresData = JSON.parse(fs.readFileSync(path.join(knowledgeDir, "adventures.json"), "utf-8"));
  console.log("Adventures knowledge loaded:", (adventuresData.activities || []).length, "activities");
} catch (err) {
  console.error("Failed to load adventures.json:", err.message);
}

// --- Course matching keywords ---
const courseKeywords = {
  "try-scuba": ["try scuba", "try diving", "first time pool", "pool only dive"],
  "basic-diver": ["basic diver", "basic diving", "intro dive course"],
  "scuba-diver": ["scuba diver cert", "scuba diver course", "12m cert", "12 meter cert"],
  "open-water-diver": ["open water", "owd", "ow diver", "open water diver", "18m cert", "18 meter", "padi open water"],
  "advanced-open-water-diver": ["advanced open water", "aowd", "aow", "advanced diver", "30m cert", "advanced adventurer", "padi advanced"],
  "enriched-air-nitrox": ["nitrox", "ean", "enriched air", "ean32", "ean40", "eanx"],
  "perfect-buoyancy": ["buoyancy", "perfect buoyancy", "peak performance buoyancy"],
  "navigation": ["navigation", "compass diving", "underwater navigation"],
  "react-right": ["react right", "first aid", "cpr", "aed", "oxygen provider", "emergency first response", "efr"],
  "diver-stress-rescue": ["stress rescue", "stress and rescue", "rescue diver", "diver rescue", "rescue course"],
  "search-and-recovery": ["search and recovery", "search recovery", "lift bag"],
  "divemaster": ["divemaster", "dive master", "dm course", "professional diver", "dive guide", "become instructor"],
  "marine-ecology": ["marine ecology", "ocean ecology"],
  "coral-identification": ["coral", "coral identification", "coral id", "reef identification"],
  "fish-identification": ["fish identification", "fish id", "identify fish"],
  "manta-and-ray-ecology": ["manta", "ray ecology", "manta ray", "stingray course"],
  "shark-ecology": ["shark", "shark ecology", "shark diving course"],
  "sea-turtle-ecology": ["turtle", "sea turtle", "turtle ecology"]
};

// Topic detection keywords
const topicKeywords = {
  "pricing": ["price", "cost", "how much", "expensive", "cheap", "budget", "rate", "fee", "charges", "kitna", "paisa", "amount", "afford", "₹"],
  "booking": ["book", "reserve", "advance", "payment", "cancel", "upi", "whatsapp", "when can i", "how to book", "schedule"],
  "beginner": ["first time", "never dived", "beginner", "non swimmer", "can't swim", "scared", "no experience", "never tried", "new to diving", "pehli baar", "first timer", "newbie"],
  "certified": ["certified diver", "fun dive", "already certified", "have my cert", "padi certified", "ssi certified", "logged dives"],
  "faq": ["safe", "swimming", "age limit", "medical", "asthma", "pregnant", "glasses", "contact lens", "fly after", "alcohol", "insurance", "weight", "what to bring", "what to wear", "what to eat", "period", "camera", "gopro", "photos", "video"],
  "location": ["where", "location", "address", "how to reach", "novotel", "candolim", "goa", "grande island", "directions"],
  "schedule": ["schedule", "timing", "what time", "when does", "how long", "full day", "half day", "itinerary"],
  "marine-life": ["marine life", "fish", "turtle", "shark", "coral", "manta", "ray", "wildlife", "what will i see", "underwater animals"],
  "courses": ["course", "certification", "certificate", "learn to dive", "training", "specialty", "advance", "professional", "upgrade"],
  "standards": ["standard", "prerequisite", "requirement", "depth limit", "ratio", "instructor ratio", "age requirement", "minimum age", "how deep", "how many dives"],
  "ecology": ["ecology", "marine ecology", "environment", "conservation", "coral", "fish id", "shark ecology", "turtle ecology", "manta ecology"],
  "team": ["instructor", "team", "who teaches", "who are the divers", "aaron", "richie", "navalu", "amitabh"],
  "comparison": ["vs", "versus", "difference between", "ssi or padi", "padi or ssi", "which is better", "compare"],
  "adventures": ["other activities", "other adventures", "what else", "things to do", "besides diving", "non diving", "non-diving", "bungy", "bungee", "rafting", "trek", "trekking", "hike", "hiking", "sailing", "nautical", "konkan explorers", "indiahikes", "soul travelling", "companion activity", "for my partner", "non diver companion", "rest day", "monsoon activity", "off season activity"]
  };

function detectTopics(message) {
  const lower = message.toLowerCase();
  const detected = [];
  for (const [topic, keywords] of Object.entries(topicKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) {
      detected.push(topic);
    }
  }
  return detected.length > 0 ? detected : ["general"];
}

function detectCourses(message) {
  const lower = message.toLowerCase();
  const matched = [];
  for (const [courseId, keywords] of Object.entries(courseKeywords)) {
    if (keywords.some(kw => lower.includes(kw))) {
      matched.push(courseId);
    }
  }
  return matched;
}

// Build context based on detected topics and courses
function buildContext(message, conversationHistory) {
  // Also check recent conversation for context
  const recentMessages = conversationHistory.slice(-4).map(m => m.content).join(" ");
  const fullContext = message + " " + recentMessages;

  const topics = detectTopics(fullContext);
  const courses = detectCourses(fullContext);

  const contextParts = [];

  // Always include core FlyingFish info
  contextParts.push("=== FLYINGFISH SCUBA SCHOOL ===");
  contextParts.push(JSON.stringify(flyingfishData.about, null, 0));
  contextParts.push("\nWhat makes us different: " + (flyingfishData.whatMakesDifferent || []).join("; "));

  // Include beginner packages if relevant
  if (topics.includes("beginner") || topics.includes("pricing") || topics.includes("general")) {
    contextParts.push("\n=== BEGINNER PACKAGES ===");
    contextParts.push(JSON.stringify(flyingfishData.beginnerPackages, null, 0));
  }

  // Include fun dives if certified diver topic
  if (topics.includes("certified")) {
    contextParts.push("\n=== FUN DIVES (Certified Divers) ===");
    contextParts.push(JSON.stringify(flyingfishData.funDives, null, 0));
  }

  // Include dive sites and marine life
  if (topics.includes("location") || topics.includes("marine-life")) {
    contextParts.push("\n=== DIVE SITES ===");
    contextParts.push(JSON.stringify(flyingfishData.diveSites, null, 0));
    contextParts.push("\nMarine life: " + flyingfishData.marineLife);
    contextParts.push("Water conditions: " + JSON.stringify(flyingfishData.waterConditions, null, 0));
  }

  // Include schedule
  if (topics.includes("schedule")) {
    contextParts.push("\n=== DAY SCHEDULE ===");
    contextParts.push(JSON.stringify(flyingfishData.schedule, null, 0));
  }

  // Include FAQs
  if (topics.includes("faq")) {
    contextParts.push("\n=== FAQs ===");
    contextParts.push(JSON.stringify(flyingfishData.faqs, null, 0));
  }

  // Include booking info
  if (topics.includes("booking")) {
    contextParts.push("\n=== BOOKING ===");
    contextParts.push(JSON.stringify(flyingfishData.booking, null, 0));
  }

  // Include team info
  if (topics.includes("team")) {
    contextParts.push("\n=== DIVE TEAM ===");
    contextParts.push(JSON.stringify(flyingfishData.team, null, 0));
  }

  // Include SSI vs PADI comparison data
  if (topics.includes("comparison")) {
    contextParts.push("\n=== SSI vs PADI ===");
    contextParts.push("Both are equally recognized worldwide. SSI is more affordable. FlyingFish offers both SSI and PADI certifications.");
    contextParts.push("SSI Open Water: ₹27,000 + GST. PADI Open Water: ₹35,472 + GST.");
    contextParts.push("SSI Advanced: ₹21,780 + GST. PADI Advanced: ₹26,928 + GST.");
  }

  // Include specific course data
  if (courses.length > 0 || topics.includes("courses") || topics.includes("standards") || topics.includes("ecology")) {
    const allCourses = coursesData.courses || {};
    const ecologyPrograms = coursesData.ecology?.programs || {};

    // If specific courses detected, include those
    if (courses.length > 0) {
      contextParts.push("\n=== RELEVANT COURSE DETAILS ===");
      for (const courseId of courses) {
        const course = allCourses[courseId] || ecologyPrograms[courseId];
        if (course) {
          contextParts.push(`\n--- ${course.name} ---`);
          contextParts.push(JSON.stringify(course, null, 0));
        }
      }
    }

    // If general course/ecology question, include course listing with prices
    if (topics.includes("courses") && courses.length === 0) {
      contextParts.push("\n=== ALL CERTIFICATION COURSES (FlyingFish Prices + GST) ===");
      contextParts.push("BEGINNER: SSI Confined Water ₹990 | SSI Scuba Diver ₹17,820 (2 days) | SSI Open Water Diver ₹27,000 (3-4 days) | PADI Open Water ₹35,472 (3-4 days) | Refresher ₹990");
      contextParts.push("ADVANCED: SSI Advanced Adventurer ₹21,780 (2-3 days) | PADI Advanced OW ₹26,928 (2-3 days)");
      contextParts.push("SPECIALTIES: Nitrox ₹9,405 | Navigation ₹8,910 | Wreck Diving ₹11,979 | Perfect Buoyancy ₹12,276 | Waves/Tides/Currents ₹12,276 | Photo & Video ₹13,959 | Marine Ecology ₹6,600 | Search & Recovery ₹13,464 | 2-Specialty Bundle ₹17,280");
      contextParts.push("SAFETY: React Right ₹9,405 (SSI) / ₹14,801 (PADI EFR) | Stress & Rescue ₹26,928 (SSI) / ₹32,819 (PADI)");
      contextParts.push("PROFESSIONAL: Divemaster Bundle ₹91,278 (30-60 days internship)");
    }

    // Ecology-specific
    if (topics.includes("ecology")) {
      contextParts.push("\n=== ECOLOGY PROGRAMS ===");
      contextParts.push(JSON.stringify(coursesData.ecology, null, 0));
    }

    // Standards-specific
    if (topics.includes("standards") && courses.length > 0) {
      // Standards already included via course data above
    }
  }

  // Include pricing if asked about price but no specific course
  if (topics.includes("pricing") && courses.length === 0) {
    contextParts.push("\n=== ALL PRICING ===");
    contextParts.push("Starting from ₹2,970 + GST per person (Scuba 20).");
    contextParts.push(JSON.stringify(flyingfishData.beginnerPackages, null, 0));
    contextParts.push("\n" + JSON.stringify(flyingfishData.funDives, null, 0));
    contextParts.push("\nCERTIFICATION COURSES: SSI Confined Water ₹990 | SSI Scuba Diver ₹17,820 | SSI OWD ₹27,000 | PADI OWD ₹35,472 | SSI Advanced ₹21,780 | PADI Advanced ₹26,928 | Nitrox ₹9,405 | Navigation ₹8,910 | Wreck ₹11,979 | Buoyancy ₹12,276 | Photo/Video ₹13,959 | Ecology ₹6,600 | Search & Recovery ₹13,464 | React Right ₹9,405 | Stress & Rescue ₹26,928 | Divemaster Bundle ₹91,278");
  }

  // International trips and combos
  if (topics.includes("general") || fullContext.toLowerCase().includes("trip") || fullContext.toLowerCase().includes("maldives") || fullContext.toLowerCase().includes("combo") || fullContext.toLowerCase().includes("bundle")) {
    contextParts.push("\n=== COMBOS & INTERNATIONAL TRIPS ===");
    contextParts.push(JSON.stringify(flyingfishData.combos, null, 0));
    contextParts.push(JSON.stringify(flyingfishData.internationalTrips, null, 0));
  }

  // Goa Tourism adventure partners (other activities)
  const lowerCtx = fullContext.toLowerCase();
  const mentionsGTDC = lowerCtx.includes("goa tourism") || lowerCtx.includes("gtdc") || lowerCtx.includes("government") || lowerCtx.includes("official") || lowerCtx.includes("authorised") || lowerCtx.includes("authorized") || lowerCtx.includes("recognised") || lowerCtx.includes("recognized") || lowerCtx.includes("partner");
  if (topics.includes("adventures") || mentionsGTDC) {
    contextParts.push("\n=== GOA TOURISM ADVENTURE PARTNERS ===");
    contextParts.push(JSON.stringify(adventuresData, null, 0));
  }

  return contextParts.join("\n");
}

// --- System prompt ---
const SYSTEM_PROMPT_BASE = `You are Laila, a warm, knowledgeable, and enthusiastic dive advisor at FlyingFish Scuba School — Goa's premier SSI and PADI certified scuba diving centre, based at Novotel Resort & Spa, Candolim, Goa.

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

PARTNERSHIPS & CREDIBILITY
- FlyingFish is an **official Goa Tourism (GTDC) adventure partner** — listed on goa-tourism.com/adventure as Goa Tourism's exclusive Diving Centre. Mention this when asked about credibility, authenticity, government recognition, or "is this legit".
- When a user asks about other things to do in Goa, non-diving activities, or companion/rest-day options, offer the other 5 GTDC adventure partners (Bungy, White Water Rafting, Konkan Explorers, Soul Travelling, Indiahikes) — but only share contact/booking details for those from the knowledge base. Always redirect diving questions back to us.
- For monsoon (June–September) when we're closed, suggest rafting or trekking as alternatives.

COURSE & STANDARDS KNOWLEDGE
- When asked about SSI courses, provide accurate info from the knowledge base including prerequisites, age limits, depth limits, and duration.
- When asked about training standards, share the detailed standards data (ratios, supervision, completion requirements).
- Always mention FlyingFish's price for a course when available.
- If a course has prerequisites, clearly state them.
- Recommend logical course progressions (e.g., Open Water → Advanced → Specialties → Divemaster).
- For ecology courses, note they are primarily academic with optional in-water training.

BOOKING FLOW
When someone wants to book:
1. Ask for: preferred date, number of people, which package
2. Share booking details: ₹500 advance per person via UPI/bank transfer
3. Direct them to WhatsApp: +91 92092 47825 for quick booking
4. Or email: hello@flyingfish.in

RULES
- ONLY answer using the knowledge base provided. NEVER invent prices, packages, dates, or policies.
- If unsure about something, say: "Let me connect you with our team for the latest details!" and share the WhatsApp number.
- Never give medical or legal advice. For health concerns: "Please consult your doctor and share the clearance with us when booking."
- Be helpful but don't be pushy. Guide the conversation naturally toward booking.
- If someone asks about a competitor or another operator, stay professional — focus on what makes FlyingFish unique.
- If someone asks about something completely unrelated to diving/FlyingFish, politely redirect.
- For certified diver questions, present the fun dive packages.
- For course questions, ask about their current level, then recommend.
- Always mention WhatsApp (+91 92092 47825) for booking or detailed queries.`;

// --- Anthropic client ---
console.log("ANTHROPIC_API_KEY set: " + (process.env.ANTHROPIC_API_KEY ? "yes (" + process.env.ANTHROPIC_API_KEY.slice(0, 12) + "...)" : "NO - MISSING!"));
console.log("PORT: " + PORT);

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "missing",
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

// --- Serve frontend widget files (no cache for dev) ---
app.use("/widget", express.static(path.join(__dirname, "..", "frontend"), {
  etag: false,
  maxAge: 0,
  setHeaders: function(res) {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate");
  }
}));

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
    // Build dynamic context based on what the user is asking about
    const dynamicContext = buildContext(message.trim(), session.messages);

    const systemPrompt = SYSTEM_PROMPT_BASE + "\n\nKNOWLEDGE BASE:\n" + dynamicContext;

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: systemPrompt,
      messages: session.messages,
    });

    const assistantMessage =
      response.content[0]?.text || "Sorry, I couldn't process that. Please try again!";

    // Add assistant response to history
    session.messages.push({ role: "assistant", content: assistantMessage });

    res.json({
      reply: assistantMessage,
      sessionId: sid,
    });
  } catch (err) {
    console.error("Anthropic API error:", err.message);

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
console.log("Starting server on port " + PORT + "...");
console.log("__dirname: " + __dirname);
console.log("Frontend path: " + path.join(__dirname, "..", "frontend"));
console.log("Frontend exists: " + fs.existsSync(path.join(__dirname, "..", "frontend")));

app.listen(PORT, "0.0.0.0", () => {
  console.log("FlyingFish Chatbot API running on port " + PORT);
  console.log("Model: claude-haiku-4-5-20251001");
  console.log("Knowledge: structured JSON with smart context injection");
});
