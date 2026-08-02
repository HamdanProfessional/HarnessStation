---
title: MCP servers
description: Connecting external tool servers, and how they're kept from flooding the model with tool definitions.
---

# MCP servers

The [Model Context Protocol](https://modelcontextprotocol.io) is a standard for
exposing tools to AI models. Connect a server and its tools become available in
your chats — GitHub, Slack, a database, a filesystem, or anything you write.

## Connecting one

**Automation › MCP Servers › Add server**. Two transports:

**stdio** — the server runs as a local process.

```json
{
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-github"],
  "env": { "GITHUB_TOKEN": "ghp_…" }
}
```

**http** — a remote server at a URL. If it uses OAuth, the app runs the sign-in
flow and stores the token in your system credential store.

You supply the credentials in both cases. The app ships none and proxies nothing.

## Progressive disclosure

This is the part worth understanding, because it's unusual.

Naively, every tool on every connected server gets described to the model on
every request. Ten servers with twenty tools each is two hundred tool
definitions — tens of thousands of tokens, spent before you've typed anything,
and a model that chooses badly because it's drowning in options.

So the app exposes **four** tools instead:

| Tool | |
| --- | --- |
| `mcp_servers` | Which servers are connected and what each is broadly for |
| `mcp_tools` | List one server's tools, by name |
| `mcp_describe` | The full schema for a specific tool |
| `mcp_call` | Call it |

The model narrows down, then reads the detail for the one thing it needs. Startup
context cost stays flat no matter how many servers you connect, and tool choice
gets better rather than worse as you add more.

The cost is an extra round trip or two before the first call. That's a good trade
past about two servers.

## Finding servers

Ask the model for a capability it hasn't got, and it can search for an MCP server
that provides it and offer to connect it. It won't connect anything needing
credentials without you supplying them.

## Troubleshooting

**Server won't start** — check the command runs in your own terminal. For `npx`
servers, the first run downloads the package and can be slow enough to time out;
run it once by hand first.

**Connected but no tools** — some servers expose tools only after
initialisation. Disconnect and reconnect.

**Auth failures** — for stdio, check the token in `env`. For OAuth over HTTP,
disconnect and reconnect to redo the flow.
