# Dear Agent — Roadmap

The shipped product: your agent keeps your diary, then remembers your life and reflects it back, fully local and private. These are directions we are exploring next.

## Ambient capture (local-first life recorder)

Always-on voice recorders (Limitless, Bee, Plaud, Friend) are normalizing the idea of a device that listens to your day and journals it for you. They are closed and cloud-based. Dear Agent can be the **open, local-first sink** for that:

- **Day one, no hardware needed:** any existing source that produces a transcript — phone voice memos, a meeting transcript, an existing pendant, a Whisper run — can be piped into Dear Agent via `add_entry` / `add_voice_note`, and the agent distills it into the day's entry.
- **Phone companion (later):** a lightweight mobile shortcut or app (iOS Shortcut / Android, then a small APK) that streams audio or on-device transcripts to the user's agent, which files the day automatically.
- **Always-on mic (much later, hard):** continuous capture with on-device transcription, battery/consent/storage handled. This is the regulated, expensive part — deliberately last.
- **The wedge is privacy:** unlike the cloud recorders, ambient capture in Dear Agent stays on the user's device. The audio of your life never leaves your machine. That is the whole point.

## Other directions

- **Structured life graph (optional):** light entities (people, places, projects) the agent can query, without becoming a heavyweight memory graph.
- **Decision counsel:** "the last two times you faced this, here is what you chose and how it felt" — surfaced at decision moments from `recall`.
- **Encryption at rest** for the diary directory, opt-in.
- **Export / portability** (single-file bundle) so a user can move their whole life-log between machines.

Notes captured 2026-06-29.
