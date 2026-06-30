# Dear Agent

**Your AI agent keeps your diary for you. You never open an app or write a word.**

You already talk to an AI agent all day. Dear Agent lets that agent quietly keep your personal life journal — filing what you tell it, the photos you send, and the voice notes you record, neatly by date. No app to open. No blank page to face. No habit to build. You just live your life and mention what matters; your agent does the writing.

It is a single, local-first [MCP](https://modelcontextprotocol.io) server plus a skill, so it drops into any agent that speaks MCP: Claude Code, Claude Desktop, Cursor, OpenClaw, and more.

## Why it is different

- **You do not write it. Your agent does.** Every other journal — Day One, Obsidian, Notion, a paper notebook — needs *you* to open it and type. Dear Agent flips that: you talk, it records.
- **Cross-agent.** One diary, readable and writable by whatever agent you use.
- **Text, photos, and voice.** Send a picture or a voice note and it is filed under that day.
- **Local-first and yours.** Plain markdown on your own disk. No account, no cloud, no lock-in. Delete the folder and it is gone.
- **It remembers with you.** "On this day" resurfaces past entries; a weekly digest lets your agent write you a short reflection.

## Install

```bash
npm install -g dear-agent
```

Or run it straight from npx (no install):

```bash
npx dear-agent
```

### Claude Code / Claude Desktop

```bash
claude mcp add dear-agent -- npx -y dear-agent
```

Or add to your MCP config:

```json
{
  "mcpServers": {
    "dear-agent": {
      "command": "npx",
      "args": ["-y", "dear-agent"]
    }
  }
}
```

### Cursor / OpenClaw / other MCP clients

Point the client at the `dear-agent` command (stdio transport). Set `DEAR_AGENT_DIR` if you want the diary somewhere other than `~/.dear-agent`.

Then drop [`SKILL.md`](./SKILL.md) into your agent's skills so it knows to keep your diary proactively.

## How you use it

You never call tools yourself. You just talk to your agent:

> "Remember that I closed the apartment lease today, felt huge relief."
> "Save this photo for today — first dinner in the new place." *(send the photo)*
> "What was I doing a year ago today?"
> "Give me a recap of this week."

Your agent calls the right tool and keeps the diary current.

## Tools

| Tool | What it does |
|------|--------------|
| `add_entry` | Save a text moment (optional mood, tags) for a day. |
| `add_photo` | Save a photo for a day (local path or base64), with a caption. |
| `add_voice_note` | Save a voice note for a day, with an optional transcript. |
| `get_day` | Read one day's full entry. |
| `get_range` | Read entries between two dates. |
| `search` | Find days matching a word or phrase. |
| `on_this_day` | Resurface this calendar day from past months and years. |
| `weekly_digest` | Pull the last 7 days for a reflection. |
| `list_days` | List every day on record. |

Dates accept `today`, `yesterday`, or `YYYY-MM-DD`.

## Where your diary lives

```
~/.dear-agent/
  entries/
    2026-06-29.md
  media/
    2026-06-29/
      first-dinner.jpg
      morning-thought.ogg
```

Set `DEAR_AGENT_DIR` to choose a different location.

## License

[MIT](./LICENSE) © BitmapAsset. Free for anyone, anywhere, in any agent.
