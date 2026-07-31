# MCP-Verbindung testen

Nach dem Render-Deployment:

```bash
curl -i -X POST "https://DEINE-ADRESSE.onrender.com/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "MCP-Protocol-Version: 2025-06-18" \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl-test","version":"1.0"}}}'
```

Erwartet: HTTP 200 und eine JSON-RPC-Antwort mit `serverInfo`.

Inspector:

- Transport: `Streamable HTTP`
- URL: `https://DEINE-ADRESSE.onrender.com/mcp`
- Authentication: keine
