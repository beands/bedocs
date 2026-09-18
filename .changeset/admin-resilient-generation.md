---
"@beands/bedocs": patch
---

Make admin-panel AI documentation generation fault-tolerant and modernize the admin UI. Generation now runs as a persistent background job (`admin/.jobs/`) instead of one long HTTP request: every finished page is written to disk immediately, in-flight output is checkpointed as a draft, and the job survives tab closes and server restarts — resuming from the last checkpoint without regenerating saved pages. The crea-ai client supports SSE streaming, remote async-job polling, retryable-error backoff with `Retry-After`, and deduplication of identical requests. New endpoints expose job state, an SSE event stream with `Last-Event-ID` replay, and resume/retry/cancel controls. The admin UI is rebuilt as a modular SPA with a light/dark design system, local Lucide icons and Inter font (no CDN, no emoji), a live generation monitor with streaming draft preview, and server-side validation that closes path-traversal gaps on project and file names.
