import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(join(__dirname, "../public/widget.html"), "utf8");
const cards = JSON.parse(readFileSync(join(__dirname, "../data/cards.json"), "utf8")) as Array<{ id: number; name: string; arcana: string; suit: string | null; img: string }>;
const cardById = new Map(cards.map((card) => [card.id, card]));
const WIDGET_URI = "ui://widget/bertollo-raisch-tarot-v1.html";

function createServer() {
  const server = new McpServer({ name: "bertollo-raisch-tarot", version: "1.4.8" });

  server.registerResource(
    "bertollo-raisch-tarot-widget",
    WIDGET_URI,
    {},
    async () => ({
      contents: [{
        uri: WIDGET_URI,
        mimeType: "text/html;profile=mcp-app",
        text: widgetHtml,
        _meta: {
          "openai/widgetDescription": "Interaktive Tarot-App mit sechs Legungen und den eigenen 78 Kartenbildern. Nutzer ziehen Karten oder geben physisch gelegte Karten ein und übergeben die Legung an den aktuellen ChatGPT-Chat.",
          "openai/widgetPrefersBorder": false,
          "ui": {
            "csp": { "connectDomains": [], "resourceDomains": [] }
          }
        }
      }]
    })
  );

  server.registerTool(
    "open_tarot_app",
    {
      title: "Bertollo Tarot öffnen",
      description: "Öffnet die interaktive Bertollo Tarot-App. Verwende dieses Tool, wenn die Person Tarotkarten ziehen, eine Legung auswählen oder eigene physisch gelegte Karten eingeben möchte.",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      _meta: {
        "ui/resourceUri": WIDGET_URI,
        "openai/outputTemplate": WIDGET_URI,
        "openai/toolInvocation/invoking": "Tarot-App wird geöffnet …",
        "openai/toolInvocation/invoked": "Tarot-App ist bereit."
      }
    },
    async () => ({
      content: [{ type: "text", text: "Die Bertollo Tarot-App ist geöffnet. Wähle in der Oberfläche eine Legung." }],
      structuredContent: { app: "bertollo-raisch-tarot", version: "1.4.8", language: "de", provider: "Bertollo", storesUserData: false },
      _meta: { "ui/resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI }
    })
  );

  server.registerTool(
    "tarot_app_help",
    {
      title: "Tarot-App erklären",
      description: "Erklärt kurz die sechs verfügbaren Legungen der Bertollo Tarot-App.",
      inputSchema: { topic: z.string().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async () => ({ content: [{ type: "text", text: "Verfügbar sind Tageskarte/Einkartenlegung, Drei-Karten-Legung, Ja/Nein, Kleines Kreuz, Keltisches Kreuz und Eigene Karten für eine physisch gelegte Kartenfolge." }] })
  );
  return server;
}

const app = express();
app.set("trust proxy", true);
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization, X-Family-Code");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(), on-device-speech-recognition=(self)");
  next();
});
app.use(express.json({ limit: "256kb" }));
app.use(express.static(join(__dirname, "../public"), { index: false, maxAge: "1h" }));
app.get("/", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/app.html")));
app.get("/privacy", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/privacy.html")));
app.get("/terms", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/terms.html")));
app.get("/support", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/support.html")));
app.get("/imprint", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/imprint.html")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "bertollo-raisch-tarot", version: "1.4.8", aiConfigured: Boolean(process.env.OPENAI_API_KEY) }));


const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const OPENAI_TRANSCRIPTION_MODEL = process.env.OPENAI_TRANSCRIPTION_MODEL || "gpt-4o-mini-transcribe";
const FAMILY_ACCESS_CODE = process.env.FAMILY_ACCESS_CODE || "";
const DAILY_IP_LIMIT = Math.max(1, Number(process.env.DAILY_IP_LIMIT || 20));
const MONTHLY_REQUEST_LIMIT = Math.max(1, Number(process.env.MONTHLY_REQUEST_LIMIT || 300));
const usageByIp = new Map<string, { day: string; count: number }>();
let monthlyUsage = { month: new Date().toISOString().slice(0, 7), count: 0 };

function clientIp(req: express.Request) {
  return String(req.ip || req.socket.remoteAddress || "unknown");
}

const transcriptionUsageByIp = new Map<string, { day: string; count: number }>();
const TRANSCRIPTION_DAILY_IP_LIMIT = Math.max(1, Number(process.env.TRANSCRIPTION_DAILY_IP_LIMIT || 60));

function consumeTranscriptionUsage(req: express.Request, res: express.Response) {
  const day = new Date().toISOString().slice(0, 10);
  const ip = clientIp(req);
  const current = transcriptionUsageByIp.get(ip);
  const record = current?.day === day ? current : { day, count: 0 };
  if (record.count >= TRANSCRIPTION_DAILY_IP_LIMIT) {
    res.status(429).json({ error: "Das tägliche Spracheingabe-Limit wurde erreicht. Bitte später erneut versuchen." });
    return false;
  }
  record.count += 1;
  transcriptionUsageByIp.set(ip, record);
  return true;
}

const FAMILY_COOKIE = "bertollo_family_access";
const FAMILY_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180;

function parseCookies(req: express.Request) {
  const result: Record<string, string> = {};
  const header = req.get("cookie") || "";
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function familyToken() {
  return createHmac("sha256", FAMILY_ACCESS_CODE).update("bertollo-raisch-family-access-v1").digest("hex");
}

function safeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function hasFamilyAccess(req: express.Request) {
  if (!FAMILY_ACCESS_CODE) return true;
  const cookieToken = parseCookies(req)[FAMILY_COOKIE] || "";
  if (cookieToken && safeEqual(cookieToken, familyToken())) return true;
  // Backwards compatibility for older clients. New browser UI uses the HttpOnly cookie.
  const supplied = String(req.get("X-Family-Code") || "");
  return Boolean(supplied) && safeEqual(supplied, FAMILY_ACCESS_CODE);
}

function checkFamilyAccess(req: express.Request, res: express.Response) {
  if (hasFamilyAccess(req)) return true;
  res.status(401).json({ error: "Familiencode fehlt oder ist falsch.", code: "FAMILY_ACCESS_DENIED" });
  return false;
}

function setFamilyCookie(req: express.Request, res: express.Response) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  const attributes = [
    `${FAMILY_COOKIE}=${encodeURIComponent(familyToken())}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${FAMILY_COOKIE_MAX_AGE_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

function clearFamilyCookie(req: express.Request, res: express.Response) {
  const secure = req.secure || req.get("x-forwarded-proto") === "https";
  const attributes = [`${FAMILY_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
}

app.get("/api/auth/status", (req, res) => {
  res.json({ required: Boolean(FAMILY_ACCESS_CODE), authenticated: hasFamilyAccess(req) });
});

app.post("/api/auth/login", (req, res) => {
  if (!FAMILY_ACCESS_CODE) return res.json({ required: false, authenticated: true, message: "Für diese App ist kein Familiencode erforderlich." });
  const supplied = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  if (!supplied || !safeEqual(supplied, FAMILY_ACCESS_CODE)) {
    return res.status(401).json({ error: "Der Familiencode ist nicht korrekt.", code: "INVALID_FAMILY_CODE" });
  }
  setFamilyCookie(req, res);
  res.json({ required: true, authenticated: true, message: "Code wurde akzeptiert und für zukünftige Besuche gespeichert." });
});

app.post("/api/auth/logout", (req, res) => {
  clearFamilyCookie(req, res);
  res.json({ authenticated: false });
});

function consumeUsage(req: express.Request, res: express.Response) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  const month = now.toISOString().slice(0, 7);
  if (monthlyUsage.month !== month) monthlyUsage = { month, count: 0 };
  if (monthlyUsage.count >= MONTHLY_REQUEST_LIMIT) {
    res.status(429).json({ error: "Das monatliche Familienkontingent ist erreicht." });
    return false;
  }
  const ip = clientIp(req);
  const entry = usageByIp.get(ip);
  const current = entry?.day === day ? entry : { day, count: 0 };
  if (current.count >= DAILY_IP_LIMIT) {
    res.status(429).json({ error: "Das Tageslimit für diesen Zugang ist erreicht." });
    return false;
  }
  current.count += 1;
  usageByIp.set(ip, current);
  monthlyUsage.count += 1;
  return true;
}

const interpretationInstructions = `Du bist Bertollo–Raisch Tarot. Deute auf Deutsch, psychologisch fundiert, klar, ehrlich und knapp. Alle Karten sind aufrecht. Keine Garantien, Wunschdeutungen, Angstmacherei oder unbegründeten Behauptungen über andere Personen. Tarot dient Unterhaltung und Selbstreflexion.

Gib ausschließlich valides JSON zurück, ohne Markdown-Codeblock und ohne Text außerhalb des JSON. Verwende exakt diese Struktur:
{
  "history_title": "thematischer Titel der Legung in 1 bis 3 Wörtern",
  "subject": "Worum es bei der Legung geht, in 1–2 kurzen Sätzen",
  "positions": [
    {"number": 1, "position": "Positionsname", "card": "Kartenname", "interpretation": "knappe positionsbezogene Deutung"}
  ],
  "summary": "kurze Zusammenfassung des Verlaufs",
  "overall_analysis": "Zusammenspiel und wichtigste psychologische Dynamik",
  "assessment": "realistische, ungeschönte Einschätzung ohne Absolutheit",
  "key_message": "prägnante Kernaussage",
  "essence": "ein sehr kurzer Satz",
  "reflection_question": "eine konkrete Reflexionsfrage",
  "suggested_followup": "genau eine konkrete Tarot-Folgefrage, die mit genau einer neuen Karte vertieft werden kann"
}

Regeln zur Länge:
- subject höchstens 45 Wörter.
- Jede Positionsdeutung höchstens 70 Wörter; bei 10 Karten höchstens 45 Wörter.
- summary, overall_analysis und assessment jeweils höchstens 90 Wörter.
- key_message höchstens 55 Wörter.
- essence genau ein kurzer Satz.
- Keine Wiederholungen zwischen den Abschnitten.
- Deute jede Karte exakt in ihrer gelieferten Position.
- Bei Ja/Nein muss assessment mit „Eher Ja“, „Vorsichtiges Ja“, „Offen“, „Eher Nein“ oder „Deutliches Nein“ beginnen und klarstellen, dass es nur eine Tendenz ist.
- history_title besteht aus 1 bis 3 aussagekräftigen Wörtern und benennt das konkrete Thema, zum Beispiel „Beruflicher Umbruch“, „Familiäre Klärung“ oder „Neue Beziehung“. Verwende nicht nur den Namen der Legungsart.
- suggested_followup ist immer eine echte Tarot-Folgefrage für genau eine weitere Karte. Sie muss aus der konkreten Legung entstehen: bevorzuge die Abschluss- oder Zukunftsposition, eine dominante Große Arkana, eine auffällige Spannung oder einen noch unklaren Wendepunkt.
- Formuliere suggested_followup so, dass die neue Karte etwas konkretisiert, zum Beispiel „Was zeigt sich nach dem Turm?“, „Welche Entwicklung eröffnet die Sonne in der Ergebnisposition?“ oder „Was muss verstanden werden, damit sich die Zwei der Schwerter lösen kann?“
- Keine Chat-Assistenten-Fragen, keine Angebote wie „Soll ich dir helfen …?“ und keine allgemeinen Verhaltenstipps als Folgefrage.`;

const followupInstructions = `Du deutest eine einzelne neue Folgekarte zu einer bereits bestehenden Tarotlegung. Beantworte ausschließlich die neue Folgefrage. Nutze die ursprüngliche Legung als Kontext und die neu gezogene Folgekarte als Fokus. Alle Karten sind aufrecht. Erfinde keine weiteren Karten oder Tatsachen. Schreibe knapp, psychologisch fundiert und ohne Garantien.

Gib ausschließlich valides JSON zurück:
{
  "history_title": "kurzer thematischer Titel in 1 bis 3 Wörtern",
  "subject": "Folgefrage in eigenen Worten",
  "positions": [
    {"number": 1, "position": "Folgekarte", "card": "Name der neuen Folgekarte", "interpretation": "konkrete Deutung dieser Karte zur Folgefrage"}
  ],
  "summary": "wahrscheinlichste Antwort auf die Folgefrage",
  "overall_analysis": "Verbindung der Folgekarte mit der ursprünglichen Legung",
  "assessment": "realistische Einschätzung",
  "key_message": "prägnante Kernaussage",
  "essence": "ein kurzer Satz",
  "reflection_question": "eine konkrete Reflexionsfrage",
  "suggested_followup": "genau eine weitere konkrete Tarot-Folgefrage für eine neue Karte"
}
Die Positionsdeutung höchstens 75 Wörter, jeder weitere längere Abschnitt höchstens 90 Wörter. Keine Wiederholungen.
Die weitere Folgefrage muss unmittelbar aus der neu gezogenen Folgekarte und dem noch offenen Punkt der ursprünglichen Legung entstehen. Sie soll einen konkreten Kartenprozess, eine Entwicklung oder eine auffällige Spannung vertiefen. Keine Chat-Assistenten-Angebote, keine organisatorischen Hilfsfragen und keine allgemeinen Ratschlagsfragen.`;

type ReadingResult = {
  history_title: string;
  subject: string;
  positions: Array<{ number: number; position: string; card: string; interpretation: string }>;
  summary: string;
  overall_analysis: string;
  assessment: string;
  key_message: string;
  essence: string;
  reflection_question: string;
  suggested_followup: string;
};

const readingJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["history_title", "subject", "positions", "summary", "overall_analysis", "assessment", "key_message", "essence", "reflection_question", "suggested_followup"],
  properties: {
    history_title: { type: "string" },
    subject: { type: "string" },
    positions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "position", "card", "interpretation"],
        properties: {
          number: { type: "integer" },
          position: { type: "string" },
          card: { type: "string" },
          interpretation: { type: "string" },
        },
      },
    },
    summary: { type: "string" },
    overall_analysis: { type: "string" },
    assessment: { type: "string" },
    key_message: { type: "string" },
    essence: { type: "string" },
    reflection_question: { type: "string" },
    suggested_followup: { type: "string" },
  },
} as const;

function parseReadingJson(text: string): ReadingResult {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  const jsonText = firstBrace >= 0 && lastBrace > firstBrace ? cleaned.slice(firstBrace, lastBrace + 1) : cleaned;
  const data = JSON.parse(jsonText);
  const stringValue = (value: unknown) => typeof value === "string" ? value.trim() : "";
  const positions = Array.isArray(data.positions) ? data.positions.map((item: any, index: number) => ({
    number: Number.isFinite(Number(item?.number)) ? Number(item.number) : index + 1,
    position: stringValue(item?.position),
    card: stringValue(item?.card),
    interpretation: stringValue(item?.interpretation),
  })).filter((item: any) => item.card || item.interpretation) : [];
  return {
    history_title: stringValue(data.history_title),
    subject: stringValue(data.subject), positions,
    summary: stringValue(data.summary), overall_analysis: stringValue(data.overall_analysis),
    assessment: stringValue(data.assessment), key_message: stringValue(data.key_message),
    essence: stringValue(data.essence), reflection_question: stringValue(data.reflection_question),
    suggested_followup: stringValue(data.suggested_followup),
  };
}

app.post("/api/transcribe", express.raw({
  type: ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "application/octet-stream"],
  limit: "8mb",
}), async (req, res) => {
  if (!checkFamilyAccess(req, res)) return;
  if (!openai) return res.status(503).json({ error: "Die OpenAI-Verbindung ist noch nicht eingerichtet." });
  if (!Buffer.isBuffer(req.body) || req.body.length < 100) return res.status(400).json({ error: "Es wurden keine verwertbaren Audiodaten empfangen." });
  if (!consumeTranscriptionUsage(req, res)) return;

  const contentType = (req.get("content-type") || "audio/webm").split(";")[0].trim().toLowerCase();
  const extensionByType: Record<string, string> = {
    "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "m4a",
    "audio/mpeg": "mp3", "audio/wav": "wav", "application/octet-stream": "webm",
  };
  const extension = extensionByType[contentType] || "webm";
  try {
    const audioFile = new File([req.body], `spracheingabe.${extension}`, { type: contentType });
    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: OPENAI_TRANSCRIPTION_MODEL,
      language: "de",
      prompt: "Deutsche Tarotfrage. Häufige Wörter: Kelche, Münzen, Stäbe, Schwerter, Ass, Narr, Die Liebenden, Keltisches Kreuz.",
    });
    const text = typeof transcription.text === "string" ? transcription.text.trim() : "";
    if (!text) return res.status(422).json({ error: "In der Aufnahme wurde kein verständlicher Text erkannt." });
    res.json({ text, model: OPENAI_TRANSCRIPTION_MODEL, storedByApp: false });
  } catch (error: any) {
    console.error("OpenAI transcription failed", { status: error?.status, message: error?.message, code: error?.code, type: error?.type });
    const isLimit = error?.status === 429;
    res.status(isLimit ? 429 : 502).json({
      error: isLimit ? "OpenAI-Nutzungslimit erreicht. Bitte später erneut versuchen." : "Die Spracheingabe konnte gerade nicht transkribiert werden. Bitte versuche es erneut.",
    });
  }
});

app.post("/api/interpret", async (req, res) => {
  if (!checkFamilyAccess(req, res)) return;
  if (!openai) return res.status(503).json({ error: "Die OpenAI-Verbindung ist noch nicht eingerichtet." });
  const spread = typeof req.body?.spread === "string" ? req.body.spread.slice(0, 30) : "custom";
  const spreadTitle = typeof req.body?.spread_title === "string" ? req.body.spread_title.slice(0, 120) : "Tarotlegung";
  const question = typeof req.body?.question === "string" ? req.body.question.trim().slice(0, 2000) : "";
  const followupQuestion = typeof req.body?.followup_question === "string" ? req.body.followup_question.trim().slice(0, 1200) : "";
  const previousReading = typeof req.body?.previous_reading === "string" ? req.body.previous_reading.trim().slice(0, 6000) : "";
  const responseLength = ["short", "medium", "long"].includes(req.body?.response_length) ? req.body.response_length : "medium";
  const rawCards = Array.isArray(req.body?.cards) ? req.body.cards : [];
  if (rawCards.length < 1 || rawCards.length > 20) return res.status(400).json({ error: "Bitte 1 bis 20 Karten übergeben." });
  const cardsForPrompt: Array<{ position: string; name: string }> = [];
  for (let i = 0; i < rawCards.length; i++) {
    const name = typeof rawCards[i]?.name === "string" ? rawCards[i].name.trim().slice(0, 100) : "";
    const position = typeof rawCards[i]?.position === "string" ? rawCards[i].position.trim().slice(0, 150) : `Position ${i + 1}`;
    if (!name) return res.status(400).json({ error: `Bei Position ${i + 1} fehlt der Kartenname.` });
    cardsForPrompt.push({ position, name });
  }
  if (!consumeUsage(req, res)) return;
  const cardsText = cardsForPrompt.map((c, i) => `${i + 1}. ${c.position}: ${c.name}`).join("\n");
  const isFollowup = Boolean(followupQuestion);
  const lengthGuidance = responseLength === "short"
    ? "Antwortlänge: kurz. Positionsdeutungen maximal 25 Wörter, übrige Abschnitte maximal 45 Wörter."
    : responseLength === "long"
      ? "Antwortlänge: ausführlich, aber ohne Wiederholungen. Positionsdeutungen maximal 85 Wörter, übrige Abschnitte maximal 130 Wörter."
      : "Antwortlänge: mittel. Halte dich an die Standard-Längenregeln.";
  const userInput = isFollowup
    ? `Ursprüngliche Frage: ${question || "Kein spezielles Thema"}

Ursprüngliche Legung und bisherige Deutung (als Kontext):
${previousReading || "Nicht übergeben"}

Neu gezogene einzelne Folgekarte:
${cardsText}

Neue Folgefrage: ${followupQuestion}

Deute genau diese neue Folgekarte in Bezug auf die Folgefrage und verbinde sie nachvollziehbar mit der ursprünglichen Legung.
${lengthGuidance}`
    : `Legung: ${spreadTitle} (${spread})
Frage/Thema: ${question || "Kein spezielles Thema"}
Alle Karten sind aufrecht.

Karten:
${cardsText}

Erstelle die strukturierte Deutung als JSON.
${lengthGuidance}`;
  try {
    const isCeltic = spread === "celtic" || cardsForPrompt.length >= 10;
    const firstBudget = isFollowup
      ? (responseLength === "long" ? 4200 : responseLength === "short" ? 2200 : 3000)
      : isCeltic
        ? (responseLength === "long" ? 6000 : responseLength === "short" ? 3400 : 4800)
        : (responseLength === "long" ? 3800 : responseLength === "short" ? 1900 : 2800);
    const retryBudget = isFollowup
      ? (responseLength === "long" ? 6200 : responseLength === "short" ? 3600 : 4800)
      : isCeltic
        ? (responseLength === "long" ? 7800 : responseLength === "short" ? 4800 : 6500)
        : (responseLength === "long" ? 5200 : responseLength === "short" ? 3000 : 4200);

    const createInterpretation = async (maxOutputTokens: number, compactRetry: boolean) => {
      const request: any = {
        model: OPENAI_MODEL,
        instructions: isFollowup ? followupInstructions : interpretationInstructions,
        input: compactRetry
          ? `${userInput}

WICHTIGER ZWEITER VERSUCH: Antworte vollständig, aber besonders kompakt. Halte alle JSON-Felder kurz und schließe das JSON sicher ab.`
          : userInput,
        max_output_tokens: maxOutputTokens,
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "tarot_reading",
            description: "Strukturierte, kurze Tarotdeutung für die Familien-App",
            strict: true,
            schema: readingJsonSchema,
          },
        },
      };
      // GPT-5-Modelle sollen ihr Tokenbudget überwiegend für die sichtbare Antwort
      // statt für interne Überlegungen verwenden. Bei anderen Modellfamilien wird
      // dieses Feld weggelassen, damit die Anfrage kompatibel bleibt.
      if (/^gpt-5/i.test(OPENAI_MODEL)) request.reasoning = { effort: "minimal" };
      return openai.responses.create(request);
    };

    let response = await createInterpretation(firstBudget, false);
    if (response.status === "incomplete" && response.incomplete_details?.reason === "max_output_tokens") {
      console.warn("OpenAI response incomplete; retrying with larger output budget", {
        spread: isFollowup ? "followup" : spread,
        cardCount: cardsForPrompt.length,
        firstBudget,
        retryBudget,
      });
      response = await createInterpretation(retryBudget, true);
    }
    if (response.status === "incomplete") {
      const reason = response.incomplete_details?.reason ?? "unbekannt";
      throw new Error(`Unvollständige Modellantwort: ${reason}`);
    }
    const raw = response.output_text?.trim();
    if (!raw) throw new Error("Leere Modellantwort");
    const reading = parseReadingJson(raw);
    if (!isFollowup && reading.positions.length !== cardsForPrompt.length) {
      throw new Error(`Unerwartete Positionsanzahl: ${reading.positions.length} statt ${cardsForPrompt.length}`);
    }
    if (isFollowup && reading.positions.length !== 1) {
      throw new Error(`Unerwartete Folgepositionsanzahl: ${reading.positions.length} statt 1`);
    }
    res.json({ reading, interpretation: raw, isFollowup, model: OPENAI_MODEL, usage: response.usage ?? null, storedByApp: false });
  } catch (error: any) {
    console.error("OpenAI interpretation failed", {
      status: error?.status,
      message: error?.message,
      code: error?.code,
      type: error?.type,
      spread,
      cardCount: cardsForPrompt.length,
    });
    const isLimit = error?.status === 429;
    const isTimeout = error?.name === "TimeoutError" || /timeout/i.test(error?.message ?? "");
    res.status(isLimit ? 429 : isTimeout ? 504 : 502).json({
      error: isLimit
        ? "OpenAI-Nutzungslimit erreicht. Bitte später erneut versuchen."
        : isTimeout
          ? "Die Deutung hat zu lange gedauert. Bitte versuche es erneut."
          : "Die Deutung konnte gerade nicht vollständig erstellt werden. Bitte versuche es erneut.",
    });
  }
});

app.get("/api/usage", (req, res) => {
  if (!checkFamilyAccess(req, res)) return;
  const month = new Date().toISOString().slice(0, 7);
  const used = monthlyUsage.month === month ? monthlyUsage.count : 0;
  res.json({ month, used, limit: MONTHLY_REQUEST_LIMIT, dailyIpLimit: DAILY_IP_LIMIT });
});

const spreadPositions: Record<string, string[]> = {
  daily: ["Tagesimpuls"],
  three: ["Vergangenheit / Ausgangslage", "Gegenwart / Entwicklung", "Zukunft / Tendenz"],
  yesno: ["Ausgangslage", "Kernthema", "Tendenz"],
  cross: ["Gegenwart", "Herausforderung", "Grundlage", "Mögliches Ziel", "Nahe Zukunft"],
  celtic: ["Situation", "Herausforderung", "Unbewusste Grundlage", "Vergangenheit", "Bewusstes Ziel", "Nahe Zukunft", "Eigene Haltung", "Umfeld", "Hoffnungen und Ängste", "Entwicklungstendenz"],
};

function publicBaseUrl(req: express.Request) {
  return `${req.protocol}://${req.get("host")}`;
}

app.get("/api/cards", (req, res) => {
  const base = publicBaseUrl(req);
  res.json({
    count: cards.length,
    cards: cards.map(({ id, name, arcana, suit }) => ({ id, name, arcana, suit, image_url: `${base}/cards/${id}.jpg` })),
  });
});

app.get("/cards/:id.jpg", (req, res) => {
  const id = Number(req.params.id);
  const card = cardById.get(id);
  if (!card) return res.status(404).json({ error: "Karte nicht gefunden" });
  const match = /^data:image\/(jpeg|jpg);base64,(.+)$/s.exec(card.img);
  if (!match) return res.status(500).json({ error: "Ungültige Bilddaten" });
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.type("jpeg").send(Buffer.from(match[2], "base64"));
});

app.post("/api/reveal", (req, res) => {
  const spread = typeof req.body?.spread === "string" ? req.body.spread : "custom";
  const selected = Array.isArray(req.body?.selected_positions) ? req.body.selected_positions.map(Number) : [];
  if (selected.length < 1 || selected.length > 20) return res.status(400).json({ error: "Bitte 1 bis 20 verdeckte Positionen auswählen." });
  if (selected.some((n: number) => !Number.isInteger(n) || n < 1 || n > 78)) return res.status(400).json({ error: "Jede Position muss eine ganze Zahl zwischen 1 und 78 sein." });
  if (new Set(selected).size !== selected.length) return res.status(400).json({ error: "Jede verdeckte Position darf nur einmal gewählt werden." });
  const expected = spreadPositions[spread]?.length;
  if (expected && selected.length !== expected) return res.status(400).json({ error: `Für diese Legung werden genau ${expected} Karten benötigt.` });
  const shuffled = [...cards];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const base = publicBaseUrl(req);
  const positions = spreadPositions[spread] ?? [];
  res.json({
    spread,
    orientation: "aufrecht",
    cards: selected.map((hiddenPosition: number, index: number) => {
      const card = shuffled[hiddenPosition - 1];
      return {
        position: index + 1,
        meaning: positions[index] ?? `Position ${index + 1}`,
        selected_position: hiddenPosition,
        id: card.id,
        name: card.name,
        image_url: `${base}/cards/${card.id}.jpg`,
      };
    }),
    notice: "Alle Karten werden ausschließlich aufrecht verwendet.",
  });
});

app.get("/api/openapi.json", (req, res) => {
  const base = publicBaseUrl(req);
  res.json({
    openapi: "3.1.0",
    info: {
      title: "Bertollo–Raisch Tarot Karten-API",
      version: "1.4.8",
      description: "Wählt ausschließlich aufrechte Karten aus dem eigenen 78-Karten-Deck von Bertollo aus. Es werden keine Fragen oder Legungen gespeichert.",
    },
    servers: [{ url: base }],
    paths: {
      "/api/reveal": {
        post: {
          operationId: "revealTarotCards",
          summary: "Verdeckte Kartenpositionen aufdecken",
          description: "Mischt das Deck für jeden Aufruf neu und deckt die gewählten unterschiedlichen Positionen zwischen 1 und 78 auf. Alle Karten sind aufrecht.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["spread", "selected_positions"],
                  properties: {
                    spread: { type: "string", enum: ["daily", "three", "yesno", "cross", "celtic", "custom"] },
                    selected_positions: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: { type: "integer", minimum: 1, maximum: 78 } },
                  },
                  additionalProperties: false,
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Aufgedeckte Karten mit öffentlichen Bildadressen",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      spread: { type: "string" },
                      orientation: { type: "string", const: "aufrecht" },
                      cards: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            position: { type: "integer" },
                            meaning: { type: "string" },
                            selected_position: { type: "integer" },
                            id: { type: "integer" },
                            name: { type: "string" },
                            image_url: { type: "string", format: "uri" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            "400": { description: "Ungültige Auswahl" },
          },
        },
      },
      "/api/cards": {
        get: {
          operationId: "listTarotCards",
          summary: "Alle Karten des Decks auflisten",
          responses: { "200": { description: "Vollständige Kartenliste" } },
        },
      },
    },
  });
});

type SessionEntry = {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
};

const sessions = new Map<string, SessionEntry>();

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("mcp-session-id") ?? undefined;
    let entry = sessionId ? sessions.get(sessionId) : undefined;

    if (!entry) {
      if (sessionId || !isInitializeRequest(req.body)) {
        return res.status(400).json({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: invalid or missing MCP session" },
          id: req.body?.id ?? null,
        });
      }

      const server = createServer();
      let transport!: StreamableHTTPServerTransport;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, { transport, server });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
        void server.close();
      };

      await server.connect(transport);
      entry = { transport, server };
    }

    await entry.transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("MCP POST error", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal MCP server error" },
        id: req.body?.id ?? null,
      });
    }
  }
});

async function handleSessionRequest(req: express.Request, res: express.Response) {
  const sessionId = req.header("mcp-session-id") ?? undefined;
  const entry = sessionId ? sessions.get(sessionId) : undefined;
  if (!entry) {
    return res.status(400).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Invalid or missing MCP session" },
      id: null,
    });
  }
  await entry.transport.handleRequest(req, res);
}

app.get("/mcp", handleSessionRequest);
app.delete("/mcp", handleSessionRequest);

const port = Number(process.env.PORT || 8000);
app.listen(port, "0.0.0.0", () => console.log(`Tarot MCP server listening on http://localhost:${port}/mcp`));
