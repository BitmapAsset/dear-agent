#!/usr/bin/env node
/**
 * Dear Agent — your AI agent keeps your diary for you.
 *
 * A local-first MCP server. Any AI agent (Claude, Cursor, OpenClaw, ...) can use these
 * tools to maintain a human's daily life journal from text, photos, and voice notes.
 * Entries are stored as plain markdown the user owns. No app, no cloud, no lock-in.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------- storage ----------

const BASE_DIR =
  process.env.DEAR_AGENT_DIR && process.env.DEAR_AGENT_DIR.trim().length > 0
    ? path.resolve(process.env.DEAR_AGENT_DIR)
    : path.join(os.homedir(), ".dear-agent");

const ENTRIES_DIR = path.join(BASE_DIR, "entries");
const MEDIA_DIR = path.join(BASE_DIR, "media");

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTime(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function weekdayOf(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

function normalizeDate(date?: string): string {
  const d = (date ?? "").trim().toLowerCase();
  if (d === "" || d === "today") return todayISO();
  if (d === "yesterday") {
    const t = new Date();
    t.setDate(t.getDate() - 1);
    return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  }
  if (!DATE_RE.test(d)) {
    throw new Error(`Invalid date "${date}". Use YYYY-MM-DD, "today", or "yesterday".`);
  }
  return d;
}

function entryPath(dateISO: string): string {
  return path.join(ENTRIES_DIR, `${dateISO}.md`);
}

function mediaDir(dateISO: string): string {
  return path.join(MEDIA_DIR, dateISO);
}

async function ensureBase(): Promise<void> {
  await fs.mkdir(ENTRIES_DIR, { recursive: true });
  await fs.mkdir(MEDIA_DIR, { recursive: true });
}

async function readEntry(dateISO: string): Promise<string | null> {
  try {
    return await fs.readFile(entryPath(dateISO), "utf8");
  } catch {
    return null;
  }
}

async function appendBlock(dateISO: string, block: string): Promise<void> {
  await ensureBase();
  const file = entryPath(dateISO);
  const existing = await readEntry(dateISO);
  if (existing === null) {
    const header = `# ${dateISO} (${weekdayOf(dateISO)})\n`;
    await fs.writeFile(file, header + "\n" + block.trimEnd() + "\n", "utf8");
  } else {
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    await fs.appendFile(file, sep + block.trimEnd() + "\n", "utf8");
  }
}

async function listEntryDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(ENTRIES_DIR);
    return files
      .filter((f) => f.endsWith(".md") && DATE_RE.test(f.slice(0, 10)))
      .map((f) => f.slice(0, 10))
      .sort();
  } catch {
    return [];
  }
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

// Resolve a media payload (local path OR base64 data) into bytes + a safe filename.
async function resolveMedia(
  source: { path?: string; data?: string; filename?: string },
  fallbackExt: string,
): Promise<{ bytes: Buffer; filename: string }> {
  if (source.path && source.path.trim()) {
    const p = source.path.trim().replace(/^~(?=\/|$)/, os.homedir());
    const bytes = await fs.readFile(p);
    return { bytes, filename: source.filename?.trim() || path.basename(p) };
  }
  if (source.data && source.data.trim()) {
    const raw = source.data.includes(",") ? source.data.slice(source.data.indexOf(",") + 1) : source.data;
    const bytes = Buffer.from(raw, "base64");
    const name = source.filename?.trim() || `${Date.now()}${fallbackExt}`;
    return { bytes, filename: name };
  }
  throw new Error("Provide either a local file `path` or base64 `data`.");
}

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

// ---------- server ----------

const server = new McpServer({ name: "dear-agent", version: "0.1.0" });

server.tool(
  "add_entry",
  "Record a text moment in the user's diary for a given day. Call this whenever the user shares something worth remembering (an event, a feeling, a win, a thought). The user never types into an app; you capture it for them.",
  {
    text: z.string().describe("What happened, in the user's own meaning. Write it naturally, first person where it fits."),
    date: z.string().optional().describe('Day to file under: "today" (default), "yesterday", or YYYY-MM-DD.'),
    mood: z.string().optional().describe("Optional one-word mood, e.g. happy, anxious, grateful."),
    tags: z.array(z.string()).optional().describe("Optional short tags, e.g. work, family, health."),
  },
  async ({ text, date, mood, tags }) => {
    const d = normalizeDate(date);
    const meta: string[] = [];
    if (mood) meta.push(`mood: ${mood}`);
    if (tags && tags.length) meta.push(`tags: ${tags.join(", ")}`);
    const metaLine = meta.length ? `_${meta.join(" · ")}_\n\n` : "";
    await appendBlock(d, `## ${nowTime()}\n${metaLine}${text.trim()}`);
    return ok(`Saved to your diary for ${d} (${weekdayOf(d)}).`);
  },
);

server.tool(
  "add_photo",
  "Save a photo into the user's diary for a given day. The user can send their agent a picture and you store it for that date with an optional caption. Accepts a local file path or base64 image data.",
  {
    path: z.string().optional().describe("Local path to the image file."),
    data: z.string().optional().describe("Base64-encoded image bytes (data URLs accepted)."),
    filename: z.string().optional().describe("Preferred filename, e.g. sunset.jpg."),
    caption: z.string().optional().describe("Optional caption describing the photo."),
    date: z.string().optional().describe('Day to file under: "today" (default), "yesterday", or YYYY-MM-DD.'),
  },
  async ({ path: p, data, filename, caption, date }) => {
    const d = normalizeDate(date);
    const { bytes, filename: fn } = await resolveMedia({ path: p, data, filename }, ".jpg");
    await fs.mkdir(mediaDir(d), { recursive: true });
    const safe = safeName(fn);
    await fs.writeFile(path.join(mediaDir(d), safe), bytes);
    const rel = path.posix.join("..", "media", d, safe);
    await appendBlock(d, `## ${nowTime()} 📷\n![${(caption ?? safe).replace(/\]/g, " ")}](${rel})${caption ? `\n${caption}` : ""}`);
    return ok(`Photo saved to your diary for ${d} as ${safe}.`);
  },
);

server.tool(
  "add_voice_note",
  "Save a voice note into the user's diary for a given day, with an optional transcript. The user can send their agent an audio clip and you store it for that date. Accepts a local file path or base64 audio data.",
  {
    path: z.string().optional().describe("Local path to the audio file."),
    data: z.string().optional().describe("Base64-encoded audio bytes (data URLs accepted)."),
    filename: z.string().optional().describe("Preferred filename, e.g. note.ogg."),
    transcript: z.string().optional().describe("Optional transcript of what was said."),
    date: z.string().optional().describe('Day to file under: "today" (default), "yesterday", or YYYY-MM-DD.'),
  },
  async ({ path: p, data, filename, transcript, date }) => {
    const d = normalizeDate(date);
    const { bytes, filename: fn } = await resolveMedia({ path: p, data, filename }, ".ogg");
    await fs.mkdir(mediaDir(d), { recursive: true });
    const safe = safeName(fn);
    await fs.writeFile(path.join(mediaDir(d), safe), bytes);
    const rel = path.posix.join("..", "media", d, safe);
    const body = transcript ? `\n> ${transcript.trim().replace(/\n/g, "\n> ")}` : "";
    await appendBlock(d, `## ${nowTime()} 🎙️\n[Voice note](${rel})${body}`);
    return ok(`Voice note saved to your diary for ${d} as ${safe}.`);
  },
);

server.tool(
  "get_day",
  "Read back the full diary entry for one day, including any photos and voice notes filed that day.",
  {
    date: z.string().optional().describe('Day to read: "today" (default), "yesterday", or YYYY-MM-DD.'),
  },
  async ({ date }) => {
    const d = normalizeDate(date);
    const body = await readEntry(d);
    if (body === null) return ok(`No diary entry yet for ${d}.`);
    let media = "";
    try {
      const files = await fs.readdir(mediaDir(d));
      if (files.length) media = `\n\nMedia filed this day: ${files.join(", ")}`;
    } catch {
      /* none */
    }
    return ok(body + media);
  },
);

server.tool(
  "get_range",
  "Read diary entries between two dates (inclusive). Useful for reviewing a week, a trip, or a month.",
  {
    start: z.string().describe("Start date YYYY-MM-DD (inclusive)."),
    end: z.string().describe("End date YYYY-MM-DD (inclusive)."),
  },
  async ({ start, end }) => {
    const s = normalizeDate(start);
    const e = normalizeDate(end);
    const dates = (await listEntryDates()).filter((d) => d >= s && d <= e);
    if (!dates.length) return ok(`No diary entries between ${s} and ${e}.`);
    const parts: string[] = [];
    for (const d of dates) parts.push((await readEntry(d)) ?? "");
    return ok(parts.join("\n\n---\n\n"));
  },
);

server.tool(
  "search",
  "Search the whole diary for a word or phrase and return matching days with snippets.",
  {
    query: z.string().describe("Text to search for (case-insensitive)."),
    limit: z.number().int().positive().optional().describe("Max matching days to return (default 20)."),
  },
  async ({ query, limit }) => {
    const q = query.toLowerCase();
    const max = limit ?? 20;
    const dates = await listEntryDates();
    const hits: string[] = [];
    for (const d of dates) {
      const body = (await readEntry(d)) ?? "";
      const idx = body.toLowerCase().indexOf(q);
      if (idx >= 0) {
        const snippet = body.slice(Math.max(0, idx - 60), idx + 100).replace(/\s+/g, " ").trim();
        hits.push(`**${d}** … ${snippet} …`);
        if (hits.length >= max) break;
      }
    }
    return ok(hits.length ? `Found ${hits.length} day(s):\n\n${hits.join("\n\n")}` : `No diary entries match "${query}".`);
  },
);

server.tool(
  "on_this_day",
  "Resurface entries from this same calendar day in previous months and years — the 'on this day' memory. Great for a daily proactive reflection.",
  {
    date: z.string().optional().describe('Reference day: "today" (default) or YYYY-MM-DD.'),
  },
  async ({ date }) => {
    const ref = normalizeDate(date);
    const refDay = ref.slice(8, 10);
    const dates = (await listEntryDates()).filter((d) => d !== ref && d.slice(8, 10) === refDay);
    if (!dates.length) return ok(`Nothing filed on the ${refDay}th of other months yet. As the diary grows, this becomes your time machine.`);
    const parts: string[] = [];
    for (const d of dates) parts.push((await readEntry(d)) ?? "");
    return ok(`On the ${refDay}th, in the past:\n\n` + parts.join("\n\n---\n\n"));
  },
);

server.tool(
  "weekly_digest",
  "Pull the last 7 days of entries so you can write the user a short weekly reflection. Returns the raw entries; you compose the summary.",
  {
    end: z.string().optional().describe('Last day of the week window: "today" (default) or YYYY-MM-DD.'),
  },
  async ({ end }) => {
    const e = normalizeDate(end);
    const endD = new Date(e + "T00:00:00");
    const start = new Date(endD);
    start.setDate(start.getDate() - 6);
    const s = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
    const dates = (await listEntryDates()).filter((d) => d >= s && d <= e);
    if (!dates.length) return ok(`No entries in the last week (${s} to ${e}).`);
    const parts: string[] = [];
    for (const d of dates) parts.push((await readEntry(d)) ?? "");
    return ok(`Entries ${s} to ${e} (write the user a warm, short reflection from these):\n\n` + parts.join("\n\n---\n\n"));
  },
);

server.tool(
  "list_days",
  "List every day that has a diary entry, oldest to newest.",
  {},
  async () => {
    const dates = await listEntryDates();
    return ok(dates.length ? `${dates.length} day(s) on record:\n${dates.join("\n")}` : "The diary is empty so far.");
  },
);

async function main() {
  await ensureBase();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe; stdout is the MCP channel.
  process.stderr.write(`dear-agent MCP server running. Diary dir: ${BASE_DIR}\n`);
}

main().catch((err) => {
  process.stderr.write(`dear-agent fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
