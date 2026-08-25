# HarnessStation Media — MCP server

Image, speech, video and 3D generation as four MCP tools, served over stdio.
This is the satellite the media-generation freeze note points at: generation
engines live here and version independently of the app.

Zero dependencies. Node 20+.

## Tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `generate_image` | `prompt`, `size?` | inline image data URL |
| `generate_speech` | `text`, `voice?` | inline audio data URL |
| `generate_video` | `prompt` | inline video data URL |
| `generate_3d` | `prompt` | URL (meshes are too large to inline) |

## Configuration

Set `MEDIA_CONFIG` to a path holding either a dedicated config file or your
existing HarnessStation `settings.json` — the server picks out the same
`.mediaModels` / `.defaultMediaIds` fields the app's built-in tools use, so
pointing it there reuses what you already configured:

```json
{ "env": { "MEDIA_CONFIG": "~/.harnessx/settings.json" } }
```

A dedicated file takes the same shape without the rest of the settings:

```json
{
  "models": [
    {
      "id": "dalle",
      "name": "DALL·E",
      "kind": "image",
      "engine": "openai-image",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "model": "gpt-image-1",
      "options": "1024x1024"
    },
    {
      "id": "local-sd",
      "name": "Local SD",
      "kind": "image",
      "engine": "a1111",
      "baseUrl": "http://localhost:7860",
      "options": "768x768"
    }
  ],
  "defaults": { "image": "local-sd" }
}
```

Engines: `openai-image`, `a1111` (Automatic1111 / SD.Next / Forge),
`openai-speech`, `replicate` — the same four the app ships. Models without an
explicit `apiKey` fall back to the `MEDIA_API_KEY` environment variable.

## Wiring it into HarnessStation

Settings → MCP → Add server:

```json
{
  "name": "Media",
  "transport": "stdio",
  "command": "node",
  "args": ["<path-to-repo>/mcp-media/index.mjs"],
  "env": { "MEDIA_CONFIG": "<path-to-config>.json" },
  "autoConnect": true
}
```

Once this package is published to npm, that becomes the usual
`npx -y @harnessstation/mcp-media`.

## Protocol

Newline-delimited JSON-RPC 2.0 over stdio (MCP protocol 2025-03-26) — the
same transport HarnessStation's built-in client speaks. Logs go to stderr;
stdout is protocol-only.
