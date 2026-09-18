import http from "node:http";

// Programmable mock of the crea-ai OpenAI-compatible API.
// Each POST /v1/chat/completions pops the next behavior from `state.behaviors`;
// when the queue is empty a normal streaming response is returned.
//
// Behavior types:
//   { type:"stream", text, chunkSize }         SSE stream then [DONE]
//   { type:"json", text }                      plain chat.completion JSON
//   { type:"cut", text, fraction }             stream `fraction` of text then destroy socket
//   { type:"endEarly", text, fraction }        end stream without [DONE]
//   { type:"status", status, retryAfter }      HTTP error (429/500/401…)
//   { type:"queued", text, polls }             async job; GET /v1/jobs/:id succeeds after `polls` polls
//   { type:"continue", full, echoLen }         continuation: echoes the draft tail sent in the
//                                              request (like a real model), then emits the rest of `full`
//   { type:"hang", ms }                        respond after ms (timeout tests)
export async function startMockCrea() {
  const state = {
    behaviors: [],
    defaultText:
      '```file:page.mdx\n---\ntitle: "Page"\n---\n\n# Page\n\nGenerated content paragraph with enough text to pass validation. '.repeat(
        6
      ) + "\n```",
    pollsPerJob: {},
    requests: [], // parsed POST bodies,
  };

  function sseWrite(res, text, chunkSize = 40) {
    res.writeHead(200, {
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    });
    for (let i = 0; i < text.length; i += chunkSize) {
      const delta = text.slice(i, i + chunkSize);
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`
      );
    }
  }

  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
    }

    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const parsed = JSON.parse(body || "{}");
      state.requests.push(parsed);
      const b = state.behaviors.shift() || {
        text: state.defaultText,
        type: "stream",
      };
      if (process.env.CREA_DEBUG) {
        const user = (parsed.messages || [])
          .filter((m) => m.role === "user")
          .map((m) => String(m.content).slice(0, 40));
        console.log(
          `MOCK POST #${state.requests.length} behavior=${b.type} users=${JSON.stringify(user)}`
        );
      }

      switch (b.type) {
        case "json": {
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              choices: [{ message: { content: b.text } }],
              usage: { total_tokens: 10 },
            })
          );
        }
        case "stream": {
          sseWrite(res, b.text, b.chunkSize);
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        case "endEarly": {
          sseWrite(
            res,
            b.text.slice(0, Math.floor(b.text.length * (b.fraction ?? 0.5))),
            b.chunkSize
          );
          return res.end(); // clean EOF, no [DONE]
        }
        case "cut": {
          sseWrite(
            res,
            b.text.slice(0, Math.floor(b.text.length * (b.fraction ?? 0.5))),
            b.chunkSize
          );
          return res.socket.destroy();
        }
        case "status": {
          const headers = { "Content-Type": "application/json" };
          if (b.retryAfter) {
            headers["Retry-After"] = String(b.retryAfter);
          }
          res.writeHead(b.status, headers);
          return res.end(
            JSON.stringify({
              error: { message: b.message || `mock error ${b.status}` },
            })
          );
        }
        case "continue": {
          // Faithful continuation: find where the draft tail (sent in the
          // continuation prompt) ends inside `full`, echo the last `echoLen`
          // chars before it, then stream the true remainder.
          const lastMsg = [...(parsed.messages || [])]
            .reverse()
            .find((m) => m.role === "user");
          const draftMatch = String(lastMsg?.content || "").match(
            /```mdx\n([\s\S]*?)```/
          );
          const draftTail = draftMatch ? draftMatch[1] : "";
          const anchor = draftTail.slice(-60);
          let anchorEnd = b.full.length;
          if (anchor) {
            const pos = b.full.indexOf(anchor);
            if (pos !== -1) {
              anchorEnd = pos + anchor.length;
            }
          }
          const echoLen = b.echoLen ?? 100;
          const emitted = b.full.slice(Math.max(0, anchorEnd - echoLen));
          sseWrite(res, emitted, b.chunkSize);
          res.write("data: [DONE]\n\n");
          return res.end();
        }
        case "queued": {
          const id = `job-${state.requests.length}-${Date.now()}`;
          (state.jobResults ||= {})[id] = {
            pollsNeeded: b.polls ?? 2,
            text: b.text,
          };
          res.writeHead(200, { "Content-Type": "application/json" });
          return res.end(
            JSON.stringify({
              id,
              status: "queued",
              status_url: `/v1/jobs/${id}`,
            })
          );
        }
        case "hang": {
          return setTimeout(() => {
            sseWrite(res, b.text || state.defaultText, b.chunkSize);
            res.write("data: [DONE]\n\n");
            res.end();
          }, b.ms || 5000);
        }
        default: {
          res.writeHead(500);
          return res.end();
        }
      }
    }

    if (req.method === "GET" && req.url.startsWith("/v1/jobs/")) {
      const id = req.url.split("/").pop();
      const jr = state.jobResults?.[id];
      if (!jr) {
        res.writeHead(404);
        return res.end("{}");
      }
      state.pollsPerJob[id] = (state.pollsPerJob[id] || 0) + 1;
      res.writeHead(200, { "Content-Type": "application/json" });
      if (state.pollsPerJob[id] >= jr.pollsNeeded) {
        return res.end(
          JSON.stringify({
            result: { choices: [{ message: { content: jr.text } }] },
            status: "succeeded",
          })
        );
      }
      return res.end(JSON.stringify({ status: "running" }));
    }

    if (req.url === "/v1/models") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(
        JSON.stringify({
          data: [{ id: "mock-model" }, { id: "gemini-2-5-flash" }],
        })
      );
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, state, url: `http://127.0.0.1:${port}/v1` };
}
