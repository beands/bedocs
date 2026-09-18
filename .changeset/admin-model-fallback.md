---
"@beands/bedocs": patch
---

Generation no longer stalls on crea-ai stream quirks or single-model failures. The API closes SSE streams with a clean EOF and never sends the `[DONE]` sentinel — responses that arrive with content are now accepted instead of discarded and retried forever. When a model exhausts its retries (or rejects the request outright), the job automatically switches to the next model in a configurable fallback chain (`fallbackModels` setting, default `gemini-3-8-flash, gemini-3-7-flash, grok-4-6`) and keeps going without pausing. Mid-file truncations are detected and continued from the saved draft. "Paused" now means the whole chain failed — a global outage — and the job auto-resumes after a cooldown until it finishes or needs attention.
