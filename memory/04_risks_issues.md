# Risks And Issues

## Active Risks

- `openclaw.json` contains live runtime credentials and network settings; edits must avoid accidental exposure or breakage
- This directory is a runtime home, not a clean source repo, so validation paths may differ from normal code projects
- Claude CLI headless auth is OK, but the OpenClaw auth profile `anthropic:claude-cli` is still missing for the main agent
- Sandbox-local `openclaw doctor` can produce EPERM false negatives; real verification should be run outside sandbox
- Persona identity is duplicated across `workspace/IDENTITY.md`, `workspace/AGENTS.md`, and root `AGENTS.md`; future edits can drift if not kept aligned
- Persistence writes can still over-trigger if future sessions ignore the engineering-mode gate; keep the trigger narrow
- Voice-call transcription now expects `deepgram` or `openai` runtime credentials; without a live API key in the service environment, Chinese mic input still will not transcribe reliably
- `voice-call` is not the browser chat mic; configuring it with realtime+streaming together breaks startup, and the actual chat mic likely lives in the browser or OS speech layer
- The chat mic patch currently lives in the installed bundled asset [index-3TlQe5hN.js](C:\Users\MSI\AppData\Roaming\npm\node_modules\openclaw\dist\control-ui\assets\index-3TlQe5hN.js); future OpenClaw upgrades may overwrite it
- Even with the forced `zh-CN` patch and HTML cache-bust, Bryan still reports the chat mic hears Chinese incorrectly; remaining likely cause is browser/OS Web Speech behavior rather than OpenClaw runtime config
- Telegram bundled channel still emits `spawnSync C:\Program Files\nodejs\node.exe EPERM` during health checks even though gateway health recovers; likely sandbox/runtime false positive

## Control Strategy

- Prefer small, reversible edits
- Do not rotate or reveal secrets unless explicitly requested
- Validate against existing health metadata after each change
