# Next Phase Plan

- Version: v1.0
- Current Phase: Phase 3

## Phase 1 - Audit and Scope

- Identify which OpenClaw area Bryan wants adjusted
- Prefer minimal-risk, performance-friendly config edits
- Avoid core architecture changes

## Phase 2 - Controlled Adjustment

- Repair bundled plugin runtime dependencies
- Let doctor clean orphan session transcript state
- Recheck plugin/channel health after modification

## Phase 3 - Verification and Handoff

- Validate that OpenClaw still boots and key integrations stay healthy
- Decide whether to harden remaining optional items like Claude auth profile
- Record final state, risks, and next suggestions
- If Bryan wants, consolidate persona ownership into one canonical file and let other files reference it
- Keep persistence writes disabled for ordinary discussion; only engineering mode should touch the 7 memory files
- After restarts, do one retry health check before treating gateway issues as real failures
- Verify voice-call transcription on a live run once a valid API key is present in the gateway runtime
- Inspect the browser/system speech input path for the chat mic, since that path is separate from `voice-call` and likely owns the Chinese-to-English misrecognition
- Have Bryan refresh the Control UI and re-test Chinese dictation on the chat mic; only continue debugging if the patched `zh-CN` browser speech path still misrecognizes
- If Chinese dictation still fails after cache-busting and reopen, verify whether the browser Web Speech engine itself lacks Chinese recognition support on this machine

## Pending Decision

- Whether to also fix the remaining optional Claude CLI auth profile gap
- Whether to consolidate duplicated persona definitions to avoid drift
- Whether to keep the persistence gate documented in `workspace/*` and root `memory/*` as the canonical rule
- Whether to provision the missing transcription API key in the service environment so Chinese voice input actually works end-to-end
- Whether to adjust Windows/Chrome speech language settings for the browser mic path

## Operating Defaults (Captured 2026-04-26)

- Work priority: Stability > Cost > Speed > Feature expansion
- Response style: minimal; no long explanations unless asked
- Always persist: decisions, next steps, risks into `C:\Users\MSI\.openclaw\memory\01~05`
