import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(join(__dirname, "../public/widget.html"), "utf8");
const WIDGET_URI = "ui://widget/bertollo-raisch-tarot-v1.html";

function createServer() {
  const server = new McpServer({ name: "bertollo-raisch-tarot", version: "1.1.1" });

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
          "openai/widgetDescription": "Interaktive Tarot-App mit fünf Legungen und den eigenen 78 Kartenbildern. Nutzer ziehen Karten oder geben physisch gelegte Karten ein und übergeben die Legung an den aktuellen ChatGPT-Chat.",
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
      structuredContent: { app: "bertollo-raisch-tarot", version: "1.1.1", language: "de", provider: "Bertollo", storesUserData: false },
      _meta: { "ui/resourceUri": WIDGET_URI, "openai/outputTemplate": WIDGET_URI }
    })
  );

  server.registerTool(
    "tarot_app_help",
    {
      title: "Tarot-App erklären",
      description: "Erklärt kurz die fünf verfügbaren Legungen der Bertollo–Raisch Tarot-App.",
      inputSchema: { topic: z.string().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false }
    },
    async () => ({ content: [{ type: "text", text: "Verfügbar sind Tageskarte, Ja/Nein, Kleines Kreuz, Keltisches Kreuz und Eigene Karten für eine physisch gelegte Kartenfolge." }] })
  );
  return server;
}

const app = express();
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
app.get("/", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/index.html")));
app.get("/privacy", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/privacy.html")));
app.get("/terms", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/terms.html")));
app.get("/support", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/support.html")));
app.get("/imprint", (_req, res) => res.type("html").sendFile(join(__dirname, "../public/imprint.html")));
app.get("/health", (_req, res) => res.json({ ok: true, service: "bertollo-raisch-tarot", version: "1.1.1" }));

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
