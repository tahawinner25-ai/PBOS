# 21st.dev in this project

The project ships the 21st.dev (formerly Magic MCP) skill and MCP configuration so an AI coding
assistant can search a catalog of shadcn-compatible React components, fetch their code and adapt it
to PBOS's design tokens.

## What is included

| Path | What it is |
| --- | --- |
| `.claude/skills/21st-ui/SKILL.md` | The skill. Claude Code loads it automatically when you ask for a UI component. |
| `.mcp.json` | Claude Code project MCP config. Points at `https://21st.dev/api/mcp`. |
| `.cursor/mcp.json` | The same server for Cursor. |
| `tools/magic-mcp/` | Vendored copy of the upstream package (ISC licence), for clients that only speak stdio. Not used by the app and not part of the Next.js build. The upstream npm-publish workflow was removed. |

## Turn it on

1. Get a free key at <https://21st.dev/mcp>.
2. Put it in your shell or a git-ignored env file as `API_KEY_21ST`. Never commit it.
   ```bash
   export API_KEY_21ST="your-key"
   ```
3. Start Claude Code (or Cursor) from the project root and approve the `21st` server when prompted.

Free keys cover catalog search and two component installs a day. Hosted AI generation needs a paid
plan; the skill checks `get_usage.aiGenerationEnabled` before calling it.

## Stdio-only clients

`tools/magic-mcp` is a small proxy: it reads JSON-RPC from stdin, forwards each line to
`https://21st.dev/api/mcp` with your key in the `x-api-key` header, and writes the reply to stdout.
It does not execute commands or touch the file system. To build it: `cd tools/magic-mcp && npm install && npm run build`.

## Using what it returns

Treat catalog code like any dependency: read it, keep only what you need, and restyle it to the
PBOS tokens in `src/app/globals.css`. Keep the product rules in the README (no invented numbers, labelled
examples, visible focus, reduced motion respected).
