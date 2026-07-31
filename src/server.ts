import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import OpenAI from "openai";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(join(__dirname, "../public/widget.html"), "utf8");
const cards = JSON.parse(readFileSync(join(__dirname, "../data/cards.json"), "utf8")) as Array<{ id: number; name: string; arcana: string; suit: string | null; img: string }>;
const cardById = new Map(cards.map((card) => [card.id, card]));
const WIDGET_URI = "ui://widget/bertollo-raisch-tarot-v1.html";

function createServer() {
  const server = new McpServer({ name: "bertollo-raisch-tarot", version: "1.3.0" });

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
      title: "Bertollo–Raisch Tarot öffnen",
      description: "Öffnet die interaktive Bertollo–Raisch Tarot-App. Verwende dieses Tool, wenn die Person Tarotkarten ziehen, eine Legung auswählen oder eigene physisch gelegte Karten eingeben möchte.",
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
      content: [{ type: "text", text: "Die Bertollo–Raisch Tarot-App ist geöffnet. Wähle in der Oberfläche eine Legung." }],
      structuredContent: { app: "bertollo-raisch-tarot", version: "1.3.0", language: "de", provider: "Bertollo", storesUserData: false },
      _meta: { "ui/resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI }
    })
  );

  server.registerTool(
    "tarot_app_help",
    {
      title: "Tarot-App erklären",
      description: "Erklärt kurz die sechs verfügbaren Legungen der Bertollo–Raisch Tarot-App.",
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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "256kb" }));
app.use(express.static(join(__dirname, "../public"), { index: false, maxAge: "1h" }));
app.get("/", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/app.html")));
app.get("/privacy", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/privacy.html")));
app.get("/terms", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/terms.html")));
app.get("/support", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/support.html")));
app.get("/imprint", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/imprint.html")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "bertollo-raisch-tarot", version: "1.3.0", aiConfigured: Boolean(process.env.OPENAI_API_KEY) }));


const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-mini";
const FAMILY_ACCESS_CODE = process.env.FAMILY_ACCESS_CODE || "";
const DAILY_IP_LIMIT = Math.max(1, Number(process.env.DAILY_IP_LIMIT || 20));
const MONTHLY_REQUEST_LIMIT = Math.max(1, Number(process.env.MONTHLY_REQUEST_LIMIT || 300));
const usageByIp = new Map<string, { day: string; count: number }>();
let monthlyUsage = { month: new Date().toISOString().slice(0, 7), count: 0 };

function clientIp(req: express.Request) {
  return String(req.ip || req.socket.remoteAddress || "unknown");
}

function checkFamilyAccess(req: express.Request, res: express.Response) {
  if (!FAMILY_ACCESS_CODE) return true;
  const supplied = String(req.get("X-Family-Code") || "");
  if (supplied !== FAMILY_ACCESS_CODE) {
    res.status(401).json({ error: "Familiencode fehlt oder ist falsch." });
    return false;
  }
  return true;
}

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

const interpretationInstructions = `Du bist Bertollo–Raisch Tarot, ein erfahrener deutschsprachiger Tarot-Interpreter mit psychologisch tiefer, intuitiver und strukturierter Deutungsweise.

Deute präzise, nachvollziehbar, ehrlich und psychologisch fundiert. Keine Wunschdeutung, keine unbegründete Spekulation, keine unnötige Esoterik, keine Angstmacherei und keine Garantien. Alle Karten werden ausschließlich aufrecht verwendet. Leite jede Aussage aus Frage, Position und Zusammenspiel der Karten ab. Stelle Gedanken oder Gefühle anderer Menschen nie als Tatsachen dar. Bei mehreren Lesarten nenne zuerst die wahrscheinlichste und danach nur sinnvolle Alternativen.

Untersuche, soweit durch die Karten gestützt: äußere Ereignisse, innere Prozesse, Schutzmauern, emotionale Blockaden, Beziehungsmuster, Projektionen, unausgesprochene Gefühle, Entwicklungspotenzial und wahrscheinliche Tendenz. Nimm niemals automatisch eine dritte Person an. Keine exakten Zeitversprechen.

Tarot dient Unterhaltung und Selbstreflexion. Keine medizinischen, psychotherapeutischen, rechtlichen oder finanziellen Entscheidungen vorgeben. Behaupte Schwangerschaft, Krankheit, Untreue, Trennung, Tod oder Katastrophen nie als sichere Tatsache.

Strukturiere die Antwort passend zur Legung mit Überschriften. Deute zuerst jede Position, dann das Zusammenspiel. Jede vollständige Deutung endet exakt mit den Abschnitten: Kernaussage, Essenz, Reflexionsfrage und Sinnvolle Folgefrage. Formuliere genau eine Folgefrage.`;

app.post("/api/interpret", async (req, res) => {
  if (!checkFamilyAccess(req, res)) return;
  if (!openai) return res.status(503).json({ error: "Die OpenAI-Verbindung ist noch nicht eingerichtet." });
  const spread = typeof req.body?.spread === "string" ? req.body.spread.slice(0, 30) : "custom";
  const spreadTitle = typeof req.body?.spread_title === "string" ? req.body.spread_title.slice(0, 120) : "Tarotlegung";
  const question = typeof req.body?.question === "string" ? req.body.question.trim().slice(0, 2000) : "";
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
  const userInput = `Legung: ${spreadTitle} (${spread})\nFrage/Thema: ${question || "Kein spezielles Thema"}\nAlle Karten sind aufrecht.\n\nKarten:\n${cardsForPrompt.map((c, i) => `${i + 1}. ${c.position}: ${c.name}`).join("\n")}\n\nErstelle jetzt die vollständige deutsche Deutung.`;
  try {
    const response = await openai.responses.create({
      model: OPENAI_MODEL,
      instructions: interpretationInstructions,
      input: userInput,
      max_output_tokens: 2800,
    });
    const interpretation = response.output_text?.trim();
    if (!interpretation) throw new Error("Leere Modellantwort");
    res.json({ interpretation, model: OPENAI_MODEL, usage: response.usage ?? null, storedByApp: false });
  } catch (error: any) {
    console.error("OpenAI interpretation failed", error?.status, error?.message);
    res.status(error?.status === 429 ? 429 : 502).json({ error: error?.status === 429 ? "OpenAI-Nutzungslimit erreicht. Bitte später erneut versuchen." : "Die Deutung konnte gerade nicht erstellt werden." });
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
      version: "1.3.0",
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
