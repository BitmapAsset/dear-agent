#!/usr/bin/env node
/**
 * Dear Agent — your AI agent keeps your diary for you, then remembers your life and reflects it back.
 *
 * One local-first binary, usable by ANY agent, harness, or interface:
 *   - MCP server (stdio): tools + prompts + resources       -> run with no arguments
 *   - Plain CLI: `dear-agent add "..."`, `recall`, `reflect` -> for shell-only agents
 *
 * Storage is plain markdown the user owns, under DEAR_AGENT_DIR (default ~/.dear-agent).
 * No app, no account, no cloud, no lock-in. Because it never leaves the machine, the user
 * can be completely honest with it.
 */
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
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const pad = (n: number) => (n < 10 ? "0" + n : String(n));

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
function shiftDays(dateISO: string, delta: number): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() + delta);
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
}
function normalizeDate(date?: string): string {
  const d = (date ?? "").trim().toLowerCase();
  if (d === "" || d === "today") return todayISO();
  if (d === "yesterday") return shiftDays(todayISO(), -1);
  if (!DATE_RE.test(d)) throw new Error(`Invalid date "${date}". Use YYYY-MM-DD, "today", or "yesterday".`);
  return d;
}
const entryPath = (dateISO: string) => path.join(ENTRIES_DIR, `${dateISO}.md`);
const mediaDir = (dateISO: string) => path.join(MEDIA_DIR, dateISO);

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
    await fs.writeFile(file, `# ${dateISO} (${weekdayOf(dateISO)})\n\n` + block.trimEnd() + "\n", "utf8");
  } else {
    const sep = existing.endsWith("\n") ? "\n" : "\n\n";
    await fs.appendFile(file, sep + block.trimEnd() + "\n", "utf8");
  }
}
async function listEntryDates(): Promise<string[]> {
  try {
    const files = await fs.readdir(ENTRIES_DIR);
    return files.filter((f) => f.endsWith(".md") && DATE_RE.test(f.slice(0, 10))).map((f) => f.slice(0, 10)).sort();
  } catch {
    return [];
  }
}
const safeName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_");

async function resolveMedia(
  source: { path?: string; data?: string; filename?: string },
  fallbackExt: string,
): Promise<{ bytes: Buffer; filename: string }> {
  if (source.path && source.path.trim()) {
    const p = source.path.trim().replace(/^~(?=\/|$)/, os.homedir());
    return { bytes: await fs.readFile(p), filename: source.filename?.trim() || path.basename(p) };
  }
  if (source.data && source.data.trim()) {
    const raw = source.data.includes(",") ? source.data.slice(source.data.indexOf(",") + 1) : source.data;
    return { bytes: Buffer.from(raw, "base64"), filename: source.filename?.trim() || `${Date.now()}${fallbackExt}` };
  }
  throw new Error("Provide either a local file `path` or base64 `data`.");
}

// ---------- core operations (shared by MCP + CLI) ----------

interface EntryMeta { mood?: string; tags?: string[] }

async function opAddEntry(text: string, opts: { date?: string } & EntryMeta = {}): Promise<string> {
  const d = normalizeDate(opts.date);
  const meta: string[] = [];
  if (opts.mood) meta.push(`mood: ${opts.mood}`);
  if (opts.tags && opts.tags.length) meta.push(`tags: ${opts.tags.join(", ")}`);
  const metaLine = meta.length ? `_${meta.join(" · ")}_\n\n` : "";
  await appendBlock(d, `## ${nowTime()}\n${metaLine}${text.trim()}`);
  return `Saved to your diary for ${d} (${weekdayOf(d)}).`;
}

async function opAddPhoto(src: { path?: string; data?: string; filename?: string; caption?: string; date?: string }): Promise<string> {
  const d = normalizeDate(src.date);
  const { bytes, filename } = await resolveMedia(src, ".jpg");
  await fs.mkdir(mediaDir(d), { recursive: true });
  const safe = safeName(filename);
  await fs.writeFile(path.join(mediaDir(d), safe), bytes);
  const rel = path.posix.join("..", "media", d, safe);
  await appendBlock(d, `## ${nowTime()} 📷\n![${(src.caption ?? safe).replace(/\]/g, " ")}](${rel})${src.caption ? `\n${src.caption}` : ""}`);
  return `Photo saved to your diary for ${d} as ${safe}.`;
}

async function opAddVoice(src: { path?: string; data?: string; filename?: string; transcript?: string; date?: string }): Promise<string> {
  const d = normalizeDate(src.date);
  const { bytes, filename } = await resolveMedia(src, ".ogg");
  await fs.mkdir(mediaDir(d), { recursive: true });
  const safe = safeName(filename);
  await fs.writeFile(path.join(mediaDir(d), safe), bytes);
  const rel = path.posix.join("..", "media", d, safe);
  const body = src.transcript ? `\n> ${src.transcript.trim().replace(/\n/g, "\n> ")}` : "";
  await appendBlock(d, `## ${nowTime()} 🎙️\n[Voice note](${rel})${body}`);
  return `Voice note saved to your diary for ${d} as ${safe}.`;
}

async function opGetDay(date?: string): Promise<string> {
  const d = normalizeDate(date);
  const body = await readEntry(d);
  if (body === null) return `No diary entry yet for ${d}.`;
  let media = "";
  try {
    const files = await fs.readdir(mediaDir(d));
    if (files.length) media = `\n\nMedia filed this day: ${files.join(", ")}`;
  } catch { /* none */ }
  return body + media;
}

async function opGetRange(start: string, end: string): Promise<string> {
  const s = normalizeDate(start), e = normalizeDate(end);
  const dates = (await listEntryDates()).filter((d) => d >= s && d <= e);
  if (!dates.length) return `No diary entries between ${s} and ${e}.`;
  const parts: string[] = [];
  for (const d of dates) parts.push((await readEntry(d)) ?? "");
  return parts.join("\n\n---\n\n");
}

async function opSearch(query: string, limit = 20): Promise<string> {
  const q = query.toLowerCase();
  const hits: string[] = [];
  for (const d of await listEntryDates()) {
    const body = (await readEntry(d)) ?? "";
    const idx = body.toLowerCase().indexOf(q);
    if (idx >= 0) {
      const snippet = body.slice(Math.max(0, idx - 60), idx + 100).replace(/\s+/g, " ").trim();
      hits.push(`**${d}** … ${snippet} …`);
      if (hits.length >= limit) break;
    }
  }
  return hits.length ? `Found ${hits.length} day(s):\n\n${hits.join("\n\n")}` : `No diary entries match "${query}".`;
}

async function opOnThisDay(date?: string): Promise<string> {
  const ref = normalizeDate(date);
  const md = ref.slice(5); // MM-DD
  const all = await listEntryDates();
  const sameAnniversary = all.filter((d) => d !== ref && d.slice(5) === md); // same MM-DD, other years
  if (sameAnniversary.length) {
    const parts: string[] = [];
    for (const d of sameAnniversary) parts.push((await readEntry(d)) ?? "");
    return `On this day (${MONTHS[Number(md.slice(0, 2)) - 1]} ${Number(md.slice(3))}), in past years:\n\n` + parts.join("\n\n---\n\n");
  }
  // graceful fallback while the diary is young: same day-of-month in earlier months this year
  const dd = ref.slice(8);
  const sameDom = all.filter((d) => d !== ref && d.slice(8) === dd && d < ref);
  if (sameDom.length) {
    const parts: string[] = [];
    for (const d of sameDom.slice(-3)) parts.push((await readEntry(d)) ?? "");
    return `No same-date anniversary yet, but here is the ${Number(dd)}th of earlier months:\n\n` + parts.join("\n\n---\n\n");
  }
  return `Nothing to resurface for ${md} yet. As the diary grows, this becomes the user's time machine — surface it warmly when it fills in.`;
}

async function opWeeklyDigest(end?: string): Promise<string> {
  const e = normalizeDate(end);
  const s = shiftDays(e, -6);
  const dates = (await listEntryDates()).filter((d) => d >= s && d <= e);
  if (!dates.length) return `No entries in the last week (${s} to ${e}).`;
  const parts: string[] = [];
  for (const d of dates) parts.push((await readEntry(d)) ?? "");
  return `Entries ${s} to ${e} — write the user a warm, short reflection from these:\n\n` + parts.join("\n\n---\n\n");
}

async function opListDays(): Promise<string> {
  const dates = await listEntryDates();
  return dates.length ? `${dates.length} day(s) on record:\n${dates.join("\n")}` : "The diary is empty so far.";
}

// --- the aha layer: recall (memory of the person) + reflect (it talks back) ---

const STOPWORDS = new Set([...WEEKDAYS, ...MONTHS, "The","And","But","This","That","Today","Yesterday","Tomorrow","Dear","Voice","Photo","Mood","Tags","I","My"]);
const COMMITMENT_RE = /\b(i (?:will|need to|have to|should|must|want to|plan to|am going to|'ll)|need to|planning to|going to)\b/i;

async function gatherAll(): Promise<{ date: string; body: string }[]> {
  const out: { date: string; body: string }[] = [];
  for (const d of await listEntryDates()) out.push({ date: d, body: (await readEntry(d)) ?? "" });
  return out;
}

async function opRecall(about?: string, limit = 40): Promise<string> {
  const all = await gatherAll();
  if (!all.length) return "The diary is empty, so there is nothing to recall yet.";

  if (about && about.trim()) {
    const q = about.trim().toLowerCase();
    const hits: string[] = [];
    for (const { date, body } of all) {
      for (const line of body.split("\n")) {
        if (line.toLowerCase().includes(q) && !line.startsWith("#") && line.trim()) {
          hits.push(`${date}: ${line.replace(/^>\s?/, "").trim()}`);
          if (hits.length >= limit) break;
        }
      }
      if (hits.length >= limit) break;
    }
    return hits.length
      ? `Everything the diary remembers about "${about}" (synthesize this into what you know about them/it):\n\n${hits.join("\n")}`
      : `The diary has nothing about "${about}" yet.`;
  }

  // No topic -> a profile digest the agent turns into a portrait of the person.
  const moods: Record<string, number> = {};
  const tags: Record<string, number> = {};
  const names: Record<string, number> = {};
  const commitments: string[] = [];
  for (const { date, body } of all) {
    for (const m of body.matchAll(/mood:\s*([^·_\n]+)/gi)) {
      const k = m[1].trim().toLowerCase();
      if (k) moods[k] = (moods[k] || 0) + 1;
    }
    for (const m of body.matchAll(/tags:\s*([^_\n]+)/gi)) {
      for (const t of m[1].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) tags[t] = (tags[t] || 0) + 1;
    }
    for (const m of body.matchAll(/\b[A-Z][a-z]{2,}\b/g)) {
      const w = m[0];
      if (!STOPWORDS.has(w)) names[w] = (names[w] || 0) + 1;
    }
    for (const line of body.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      if (COMMITMENT_RE.test(line)) commitments.push(`${date}: ${line.trim()}`);
    }
  }
  const top = (rec: Record<string, number>, n: number) =>
    Object.entries(rec).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} (${v})`);

  const span = `${all[0].date} → ${all[all.length - 1].date}`;
  const lines = [
    `Profile digest across ${all.length} day(s) (${span}). Use this to describe who this person is, then offer to go deeper:`,
    ``,
    `Recurring people/places (best guess, filter noise): ${top(names, 12).join(", ") || "none yet"}`,
    `Themes (tags): ${top(tags, 10).join(", ") || "none tagged yet"}`,
    `Mood pattern: ${top(moods, 8).join(", ") || "none recorded yet"}`,
    `Open loops / commitments to maybe follow up on:`,
    ...(commitments.slice(-8).map((c) => `  - ${c}`)),
  ];
  if (!commitments.length) lines.push("  - none detected");
  return lines.join("\n");
}

async function opReflect(period: "week" | "month" = "week", end?: string): Promise<string> {
  const e = normalizeDate(end);
  const s = shiftDays(e, period === "month" ? -29 : -6);
  const all = (await gatherAll()).filter((x) => x.date >= s && x.date <= e);
  const moods: Record<string, number> = {};
  const tags: Record<string, number> = {};
  const commitments: string[] = [];
  for (const { date, body } of all) {
    for (const m of body.matchAll(/mood:\s*([^·_\n]+)/gi)) {
      const k = m[1].trim().toLowerCase();
      if (k) moods[k] = (moods[k] || 0) + 1;
    }
    for (const m of body.matchAll(/tags:\s*([^_\n]+)/gi)) {
      for (const t of m[1].split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) tags[t] = (tags[t] || 0) + 1;
    }
    for (const line of body.split("\n")) {
      if (!line.startsWith("#") && line.trim() && COMMITMENT_RE.test(line)) commitments.push(`${date}: ${line.trim()}`);
    }
  }
  const top = (rec: Record<string, number>) => Object.entries(rec).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} (${v})`);
  const otd = await opOnThisDay(e);
  const parts: string[] = [];
  for (const { body } of all) parts.push(body);
  return [
    `Reflection material for the last ${period} (${s} → ${e}). Write the user a warm, specific, non-preachy reflection: notice patterns, celebrate progress, gently name any open loop. Then ask one good question.`,
    ``,
    `Days journaled this ${period}: ${all.length}`,
    `Mood pattern: ${top(moods).join(", ") || "none recorded"}`,
    `Recurring themes: ${top(tags).join(", ") || "none tagged"}`,
    `Possible open loops: ${commitments.length ? "\n  - " + commitments.slice(-6).join("\n  - ") : "none detected"}`,
    ``,
    `On this day: ${otd.startsWith("Nothing") ? "(nothing yet)" : "\n" + otd}`,
    ``,
    all.length ? `Raw entries:\n\n${parts.join("\n\n---\n\n")}` : `No entries in this window.`,
  ].join("\n");
}

// ---------- MCP server ----------

async function runMcp(): Promise<void> {
  const { McpServer } = await import("@modelcontextprotocol/sdk/server/mcp.js");
  const { StdioServerTransport } = await import("@modelcontextprotocol/sdk/server/stdio.js");
  const { z } = await import("zod");

  const server = new McpServer({ name: "dear-agent", version: "0.2.0" });
  const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const dateArg = z.string().optional().describe('Day: "today" (default), "yesterday", or YYYY-MM-DD.');

  server.tool("add_entry", "Record a text moment in the user's diary. Capture whenever they share something worth remembering — an event, feeling, win, or decision. The user never types into an app; you keep the diary for them.",
    { text: z.string().describe("What happened, in the user's own meaning, first person where it fits."), date: dateArg, mood: z.string().optional().describe("Optional one-word mood."), tags: z.array(z.string()).optional().describe("Optional short tags, e.g. work, family, health.") },
    async ({ text, date, mood, tags }) => ok(await opAddEntry(text, { date, mood, tags })));

  server.tool("add_photo", "Save a photo into the user's diary for a day (local path or base64), with an optional caption.",
    { path: z.string().optional(), data: z.string().optional(), filename: z.string().optional(), caption: z.string().optional(), date: dateArg },
    async (a) => ok(await opAddPhoto(a)));

  server.tool("add_voice_note", "Save a voice note into the user's diary for a day (local path or base64), with an optional transcript.",
    { path: z.string().optional(), data: z.string().optional(), filename: z.string().optional(), transcript: z.string().optional(), date: dateArg },
    async (a) => ok(await opAddVoice(a)));

  server.tool("get_day", "Read back one day's full diary entry, including any photos and voice notes filed that day.",
    { date: dateArg }, async ({ date }) => ok(await opGetDay(date)));

  server.tool("get_range", "Read diary entries between two dates (inclusive).",
    { start: z.string(), end: z.string() }, async ({ start, end }) => ok(await opGetRange(start, end)));

  server.tool("search", "Search the whole diary for a word or phrase; returns matching days with snippets.",
    { query: z.string(), limit: z.number().int().positive().optional() }, async ({ query, limit }) => ok(await opSearch(query, limit ?? 20)));

  server.tool("on_this_day", "Resurface entries from this same calendar date in past years (true anniversaries). The memory people fall in love with.",
    { date: dateArg }, async ({ date }) => ok(await opOnThisDay(date)));

  server.tool("weekly_digest", "Pull the last 7 days of entries so you can write the user a short weekly reflection.",
    { end: dateArg }, async ({ end }) => ok(await opWeeklyDigest(end)));

  server.tool("list_days", "List every day that has a diary entry, oldest to newest.", {}, async () => ok(await opListDays()));

  server.tool("recall", "Turn the diary into living memory of the person. With `about`, returns everything the diary knows about a person/place/topic across time. Without it, returns a profile digest (recurring people, themes, mood pattern, open commitments) for you to synthesize into who this person is. This is what makes Dear Agent a memory, not just a notebook.",
    { about: z.string().optional().describe("A person, place, project, or topic to recall. Omit for a whole-life profile digest."), limit: z.number().int().positive().optional() },
    async ({ about, limit }) => ok(await opRecall(about, limit ?? 40)));

  server.tool("reflect", "Get reflection material so you can proactively talk back to the user: patterns, progress, open loops, and on-this-day memories over the last week or month. Use for a daily check-in or weekly recap so the diary feels alive.",
    { period: z.enum(["week", "month"]).optional(), end: dateArg },
    async ({ period, end }) => ok(await opReflect(period ?? "week", end)));

  // Prompts — surface as slash-commands in clients like Claude Desktop.
  server.prompt("daily_checkin", "A warm end-of-day check-in: ask about the day and save it to the diary.", {}, () => ({
    messages: [{ role: "user", content: { type: "text", text: "Be my diarist. Warmly ask me how today went — one gentle question, not an interrogation. When I answer, save it with add_entry (capture mood and a tag or two). If it fits, surface an on_this_day memory or one kind observation from reflect." } }],
  }));
  server.prompt("weekly_reflection", "Write me a warm reflection on my week from the diary.", {}, () => ({
    messages: [{ role: "user", content: { type: "text", text: "Call reflect for the week, then write me a short, warm, specific reflection: what happened, any pattern or progress, and one gentle open loop. End with a single good question. Do not be preachy." } }],
  }));

  // Resources — for clients that prefer reading resources over calling tools.
  server.resource("diary-today", "diary://today", async (uri: URL) => ({
    contents: [{ uri: uri.href, text: await opGetDay("today") }],
  }));
  server.resource("diary-index", "diary://index", async (uri: URL) => ({
    contents: [{ uri: uri.href, text: await opListDays() }],
  }));

  await ensureBase();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`dear-agent MCP server running. Diary dir: ${BASE_DIR}\n`);
}

// ---------- CLI (so any shell-capable agent or human can use it without MCP) ----------

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const val = args[i + 1] && !args[i + 1].startsWith("--") ? args[(i++, i)] : "true";
      flags[key] = val;
    } else positional.push(args[i]);
  }
  return { positional, flags };
}

const CLI_HELP = `Dear Agent — your AI keeps your diary.

Usage:
  dear-agent                         start the MCP server (stdio) for an agent
  dear-agent add "text" [--date today] [--mood happy] [--tags work,family]
  dear-agent photo <file> [--caption "..."] [--date today]
  dear-agent voice <file> [--transcript "..."] [--date today]
  dear-agent today | day <YYYY-MM-DD> | range <start> <end>
  dear-agent search "query"
  dear-agent recall [about] | reflect [week|month]
  dear-agent on-this-day | list

Diary dir: ${BASE_DIR} (set DEAR_AGENT_DIR to change).`;

async function runCli(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  const { positional, flags } = parseFlags(rest);
  const out = (s: string) => process.stdout.write(s + "\n");
  switch (cmd) {
    case "add": out(await opAddEntry(positional.join(" "), { date: flags.date, mood: flags.mood, tags: flags.tags ? flags.tags.split(",").map((s) => s.trim()) : undefined })); break;
    case "photo": out(await opAddPhoto({ path: positional[0], caption: flags.caption, date: flags.date })); break;
    case "voice": out(await opAddVoice({ path: positional[0], transcript: flags.transcript, date: flags.date })); break;
    case "today": out(await opGetDay("today")); break;
    case "day": out(await opGetDay(positional[0])); break;
    case "range": out(await opGetRange(positional[0], positional[1])); break;
    case "search": out(await opSearch(positional.join(" "))); break;
    case "recall": out(await opRecall(positional.join(" ") || undefined)); break;
    case "reflect": out(await opReflect((positional[0] as "week" | "month") || "week")); break;
    case "on-this-day": out(await opOnThisDay()); break;
    case "list": out(await opListDays()); break;
    case "help": case "-h": case "--help": out(CLI_HELP); break;
    default: out(`Unknown command "${cmd}".\n\n` + CLI_HELP); process.exitCode = 1;
  }
}

// ---------- entry point ----------

const CLI_COMMANDS = new Set(["add","photo","voice","today","day","range","search","recall","reflect","on-this-day","list","help","-h","--help"]);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length > 0 && CLI_COMMANDS.has(argv[0])) {
    await runCli(argv);
  } else {
    await runMcp();
  }
}

main().catch((err) => {
  process.stderr.write(`dear-agent fatal: ${err?.stack || err}\n`);
  process.exit(1);
});
