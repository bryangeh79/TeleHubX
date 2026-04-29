# Handoff For New Chat

## Current State

- OpenClaw runtime root: `C:\Users\MSI\.openclaw`
- Main config file: `openclaw.json`
- Last known-good config metadata exists in `logs/config-health.json`
- Baseline memory protocol files were created on 2026-04-26
- `openclaw doctor --fix --yes` has been run successfully
- Bundled plugin runtime deps were repaired and plugin errors are now 0
- Telegram health check is OK
- Doctor archived 13 orphan transcript files into timestamped `.deleted` backups
- Main session store was manually pruned to only:
  - `3eb1249b-14a6-4613-9854-de3de6235369.jsonl`
  - `sessions.json`

## Bryan Preferences (Captured 2026-04-26)

- Priority order: Stability > Cost > Speed > Feature expansion
- Allowed scope: configuration changes, scripts/workflows, session/memory cleanup, and business project code changes are all allowed
- Communication: keep responses short; avoid verbosity
- Memory: avoid "amnesia" by persisting key decisions and preferences to `C:\Users\MSI\.openclaw\memory\`
- Persistence gate: only update the 7 memory files when the user is explicitly in engineering/project/handoff mode; ordinary discussion does not write them
- Voice input fix: `voice-call` now has `zh-CN` transcription defaults, but live verification still needs an API key in the gateway runtime
- Voice input fix is now written into `openclaw.json`; next live step is to verify the mic path with an actual runtime key, not by file inspection alone
- Correction: `voice-call` was the wrong layer for the chat mic; disabling it restores gateway health, and the Chinese-to-English problem likely lives in browser/OS speech input instead
- The actual chat mic bug was found in the control UI bundle: `SpeechRecognition` used `navigator.language`, so an English browser/system locale caused Chinese to be recognized as English/pinyin; local install now forces `zh-CN`
- The Control UI entry HTML also now uses `lang="zh-CN"` and cache-busted asset URLs, but Bryan still reports the mic is wrong; next step is browser-level verification, not more `voice-call` changes
- `main` now has an explicit workspace override: `C:\AI_WORKSPACE\Telegram Auto Bot` (it no longer relies on `agents.defaults.workspace`)

## Bryan Tooling / Budget Snapshot (Captured 2026-04-26)

- Claude Code: $100 plan
- Codex Business: available
- OpenClaw default model/provider: DeepSeek

## Bryan Core Business Types (Captured 2026-04-26)

- Build software: apps / programs / SaaS systems
- AI chat bot
- Telegram bot

## Next Recommended Step

- If needed, fix the optional Claude auth profile gap
- Otherwise move to targeted tuning of model routing, gateway, Telegram policy, or workspace defaults

## Likely Adjustment Areas

- Default model and model aliases
- Agent workspace and sandbox behavior
- Telegram channel rules
- Gateway auth or bind behavior
- Prompt and workspace memory conventions
- Persona/persistence rules
- Voice transcription runtime secrets
