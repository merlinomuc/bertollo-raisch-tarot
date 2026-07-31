import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const widgetHtml = readFileSync(join(__dirname, "../public/widget.html"), "utf8");
const WIDGET_URI = "ui://widget/bertollo-raisch-tarot-v1.html";

function createServer() {
  const server = new McpServer({ name: "bertollo-raisch-tarot", version: "1.0.0" });

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
      structuredContent: { app: "bertollo-raisch-tarot", version: 1 },
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "2mb" }));
app.get("/", (_req, res) => res.type("text").send("Bertollo–Raisch Tarot MCP server. Endpoint: /mcp"));
app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});
app.get("/mcp", (_req, res) => {
  res.setHeader("Allow", "POST, OPTIONS");
  res.status(405).json({ error: "Use POST /mcp" });
});
app.delete("/mcp", (_req, res) => {
  res.setHeader("Allow", "POST, OPTIONS");
  res.status(405).json({ error: "Stateless server" });
});

const port = Number(process.env.PORT || 8000);
app.listen(port, "0.0.0.0", () => console.log(`Tarot MCP server listening on http://localhost:${port}/mcp`));
