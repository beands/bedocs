import {
  CREA_AI_BASE,
  GEN_MAX_ATTEMPTS,
  GEN_BACKOFF_BASE_MS,
  GEN_BACKOFF_MAX_MS,
  GEN_REQUEST_TIMEOUT_MS,
  GEN_POLL_INTERVAL_MS,
  GEN_POLL_MAX_MS,
} from "./config.js";

// ─── Error classification ─────────────────────────────────────

export class CreaError extends Error {
  constructor(
    message,
    { status = 0, retryable = true, retryAfterMs = 0, body = "" } = {}
  ) {
    super(message);
    this.name = "CreaError";
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.body = body;
  }
}

const RETRYABLE_STATUSES = new Set([
  408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524,
]);
const FATAL_STATUSES = new Set([400, 401, 403, 404, 422]);

function parseRetryAfter(headers) {
  const raw = headers?.get?.("retry-after");
  if (!raw) {
    return 0;
  }
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return Math.min(seconds * 1000, 300000);
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date)) {
    return Math.min(Math.max(date - Date.now(), 0), 300000);
  }
  return 0;
}

export function classifyHttpError(status, body, headers) {
  const retryable =
    RETRYABLE_STATUSES.has(status) ||
    (!FATAL_STATUSES.has(status) && status >= 500);
  return new CreaError(
    `Crea-AI API вернул ошибку ${status}: ${String(body).slice(0, 300)}`,
    {
      body: String(body).slice(0, 1000),
      retryAfterMs: parseRetryAfter(headers),
      retryable,
      status,
    }
  );
}

export function isAbortError(err) {
  return err?.name === "AbortError";
}

export function isRetryable(err) {
  if (err instanceof CreaError) {
    return err.retryable;
  }
  if (isAbortError(err)) {
    return false;
  }
  // fetch network failures (TypeError), DNS, socket resets — retryable
  return true;
}

// ─── Retry with backoff + jitter + Retry-After ────────────────

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function withRetry(
  fn,
  { maxAttempts = GEN_MAX_ATTEMPTS, signal, onRetry } = {}
) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastErr = error;
      if (isAbortError(error)) throw error;
      if (!isRetryable(error) || attempt >= maxAttempts) throw error;
      const exp = Math.min(
        GEN_BACKOFF_BASE_MS * 2 ** (attempt - 1),
        GEN_BACKOFF_MAX_MS
      );
      const jitter = Math.floor(Math.random() * exp * 0.3);
      const wait = Math.max(error.retryAfterMs || 0, exp + jitter);
      await onRetry?.({ attempt, waitMs: wait, error: error });
      await sleep(wait, signal);
    }
  }
  throw lastErr;
}

// ─── HTTP helpers ─────────────────────────────────────────────

function combinedSignal(signal, timeoutMs = GEN_REQUEST_TIMEOUT_MS) {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) {
    signals.push(signal);
  }
  return AbortSignal.any(signals);
}

async function postChat({
  apiKey,
  model,
  messages,
  maxTokens,
  temperature = 0.3,
  stream,
  signal,
}) {
  let response;
  try {
    response = await fetch(`${CREA_AI_BASE}/chat/completions`, {
      body: JSON.stringify({
        model,
        messages,
        temperature,
        max_tokens: maxTokens || 8000,
        stream: Boolean(stream),
      }),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: combinedSignal(signal),
    });
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    if (error?.name === "TimeoutError")
      throw new CreaError("Crea-AI: таймаут запроса", { retryable: true });
    throw new CreaError(`Crea-AI: сетевая ошибка (${error.message})`, {
      retryable: true,
    });
  }
  return response;
}

async function ensureOk(response) {
  if (!response.ok) {
    const errText = await response.text().catch(() => "");
    throw classifyHttpError(response.status, errText, response.headers);
  }
}

// ─── SSE stream parsing ───────────────────────────────────────

// Parse a streaming chat.completions response. Returns accumulated text/usage.
// Throws CreaError(retryable) if the stream breaks before [DONE].
async function readChatStream(response, { signal, onDelta }) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let usage = null;
  let sawDone = false;
  let streamError = null;

  const processEvent = (dataStr) => {
    const data = dataStr.trim();
    if (!data) {
      return;
    }
    if (data === "[DONE]") {
      sawDone = true;
      return;
    }
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return; // ignore malformed keep-alive fragments
    }
    if (json.error) {
      streamError = new CreaError(
        `Crea-AI stream error: ${json.error.message || JSON.stringify(json.error).slice(0, 200)}`,
        {
          retryable: true,
          status: json.error.code || 0,
        }
      );
      return;
    }
    const delta = json.choices?.[0]?.delta?.content;
    if (typeof delta === "string" && delta.length > 0) {
      text += delta;
      onDelta?.(delta, text);
    }
    if (json.usage) {
      usage = json.usage;
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while (
        (idx = buffer.indexOf("\n\n")) !== -1 ||
        (idx = buffer.indexOf("\r\n\r\n")) !== -1
      ) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(buffer[idx] === "\r" ? idx + 4 : idx + 2);
        for (const line of block.split("\n")) {
          if (line.startsWith("data:")) {
            processEvent(line.slice(5));
          }
        }
      }
    }
  } catch (error) {
    if (error?.name === "AbortError") throw error;
    const wrapped = new CreaError(
      `Crea-AI: поток оборвался (${error.message})`,
      {
        body: text.slice(-500),
        retryable: true,
      }
    );
    wrapped.partialText = text;
    throw wrapped;
  }

  if (streamError) {
    streamError.partialText = text;
    throw streamError;
  }
  if (!sawDone) {
    // crea-ai.ru closes SSE streams with a clean EOF and never sends the
    // [DONE] sentinel — content that arrived is still a usable response.
    // An empty stream, though, is a genuine failure worth retrying.
    if (text.length > 0) {
      return { streamEnded: true, text, usage };
    }
    const err = new CreaError("Crea-AI: поток завершился без [DONE]", {
      retryable: true,
    });
    err.partialText = text;
    throw err;
  }
  return { text, usage };
}

// ─── Public API ───────────────────────────────────────────────

// One chat completion call. Handles three response modes:
//   - SSE stream (stream:true and server returns text/event-stream)
//   - plain JSON chat.completion
//   - async job: { status:"queued", id, status_url } -> { async: true, ... }
// Does NOT retry internally — wrap with withRetry at the call site.
export async function chatCompletion({
  apiKey,
  model,
  messages,
  maxTokens,
  temperature,
  stream = true,
  signal,
  onDelta,
}) {
  const response = await postChat({
    apiKey,
    maxTokens,
    messages,
    model,
    signal,
    stream,
    temperature,
  });
  await ensureOk(response);

  const contentType = response.headers.get("content-type") || "";

  if (stream && contentType.includes("text/event-stream")) {
    return readChatStream(response, { onDelta, signal });
  }

  const data = await response.json().catch(() => null);
  if (!data) {
    throw new CreaError("Crea-AI: пустой ответ", { retryable: true });
  }

  // Direct chat.completion
  if (data.choices && data.choices[0]) {
    const text =
      data.choices[0].message?.content ?? data.choices[0].delta?.content ?? "";
    return { text, usage: data.usage || null };
  }

  // Async job response — caller persists id/status_url and polls separately
  if (
    (data.status === "queued" || data.status === "running") &&
    data.status_url
  ) {
    const origin = CREA_AI_BASE.replace(/\/v1\/?$/, "");
    return {
      async: true,
      remoteJobId: data.id,
      statusUrl: data.status_url.startsWith("http")
        ? data.status_url
        : `${origin}${data.status_url}`,
    };
  }

  if (data.error) {
    const status = data.error.code || data.error.status || 0;
    throw classifyHttpError(
      typeof status === "number" && status >= 100 ? status : 502,
      data.error.message || JSON.stringify(data.error).slice(0, 300),
      response.headers
    );
  }

  throw new CreaError(
    `Crea-AI: неожиданный ответ: ${JSON.stringify(data).slice(0, 300)}`,
    { retryable: true }
  );
}

// Poll an existing async remote job until succeeded/failed.
// Safe to call again after a restart — resumes the same remote job.
export async function pollRemoteJob({ apiKey, statusUrl, signal }) {
  const deadline = Date.now() + GEN_POLL_MAX_MS;
  for (;;) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    let res;
    try {
      res = await fetch(statusUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: combinedSignal(signal, 60_000),
      });
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      throw new CreaError(`Crea-AI poll: сетевая ошибка (${error.message})`, {
        retryable: true,
      });
    }
    await ensureOk(res);
    const data = await res.json().catch(() => null);
    if (!data) {
      throw new CreaError("Crea-AI poll: пустой ответ", { retryable: true });
    }
    if (data.status === "succeeded" && data.result) {
      const { result } = data;
      if (result.choices && result.choices[0]) {
        return {
          text: result.choices[0].message?.content || "",
          usage: result.usage || null,
        };
      }
      if (typeof result === "string") {
        return { text: result, usage: null };
      }
      return { text: JSON.stringify(result), usage: null };
    }
    if (data.status === "failed") {
      throw new CreaError(`Crea-AI job failed: ${data.error || "unknown"}`, {
        retryable: false,
      });
    }
    if (Date.now() > deadline) {
      throw new CreaError("Crea-AI job timeout", { retryable: true });
    }
    await sleep(GEN_POLL_INTERVAL_MS, signal);
  }
}
