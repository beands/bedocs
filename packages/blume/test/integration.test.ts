import { describe, expect, it } from "bun:test";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  blumeIntegration,
  showBlumeErrorOverlay,
} from "../src/astro/integration.ts";
import type { Diagnostic } from "../src/core/types.ts";

type MiddlewareStack = { handle: unknown; route: string }[];

interface OverlayPayload {
  err: { id?: string; message: string; plugin: string; stack: string };
  type: string;
}

/** Run `astro:server:setup` and return the resulting middleware stack. */
const serverSetup = (
  options: Partial<Parameters<typeof blumeIntegration>[0]> = {},
  server: Record<string, unknown> = {}
): MiddlewareStack => {
  const stack: MiddlewareStack = [];
  blumeIntegration({
    contentRoutes: [],
    pages: [],
    ...options,
  }).hooks["astro:server:setup"]?.({
    server: { middlewares: { stack }, ...server },
  } as never);
  return stack;
};

type MiddlewareHandle = (
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
) => void;

/** The markdown-negotiation handle is the only middleware in the stack. */
const markdownHandle = (
  contentRoutes: string[],
  base?: string
): MiddlewareHandle =>
  serverSetup({ base, contentRoutes })[0]?.handle as MiddlewareHandle;

/** Run a handle against a bare GET/HEAD request; returns the headers it set. */
const runHandle = (
  handle: MiddlewareHandle,
  url: string,
  method = "GET"
): Record<string, string> => {
  const headers: Record<string, string> = {};
  handle(
    { headers: {}, method, url } as unknown as IncomingMessage,
    {
      setHeader: (key: string, value: string) => {
        headers[key] = value;
      },
    } as unknown as ServerResponse,
    () => {
      // The middleware always chains; nothing to observe here.
    }
  );
  return headers;
};

describe("blumeIntegration astro:config:setup", () => {
  it("injects each user page route as a prerendered route", () => {
    const injected: unknown[] = [];
    blumeIntegration({
      contentRoutes: [],
      pages: [
        { entrypoint: "/abs/changelog.astro", pattern: "/changelog" },
        { entrypoint: "/abs/example.astro", pattern: "/examples/[slug]" },
      ],
    }).hooks["astro:config:setup"]?.({
      injectRoute: (route: unknown) => injected.push(route),
    } as never);

    expect(injected).toEqual([
      {
        entrypoint: "/abs/changelog.astro",
        pattern: "/changelog",
        prerender: true,
      },
      {
        entrypoint: "/abs/example.astro",
        pattern: "/examples/[slug]",
        prerender: true,
      },
    ]);
  });
});

describe("blumeIntegration markdown negotiation", () => {
  it("rewrites a content route to its .md variant when markdown is preferred", () => {
    const handle = markdownHandle(["/guide"]);
    const req = {
      headers: { accept: "text/markdown" },
      method: "GET",
      url: "/guide",
    } as unknown as IncomingMessage;
    const headers: Record<string, string> = {};
    let nexted = false;
    handle(
      req,
      {
        setHeader: (key: string, value: string) => {
          headers[key] = value;
        },
      } as unknown as ServerResponse,
      () => {
        nexted = true;
      }
    );

    expect(req.url).toBe("/guide.md");
    expect(headers.Vary).toBe("Accept");
    expect(nexted).toBe(true);
  });

  it("leaves the request untouched when the path is not a content route", () => {
    const handle = markdownHandle(["/guide"]);
    const req = {
      headers: { accept: "text/markdown" },
      method: "GET",
      url: "/not-a-page",
    } as unknown as IncomingMessage;
    let headerSet = false;
    let nexted = false;
    handle(
      req,
      {
        setHeader: () => {
          headerSet = true;
        },
      } as unknown as ServerResponse,
      () => {
        nexted = true;
      }
    );

    expect(req.url).toBe("/not-a-page");
    expect(headerSet).toBe(false);
    expect(nexted).toBe(true);
  });

  it("does not negotiate when the client does not prefer markdown", () => {
    const handle = markdownHandle(["/guide"]);
    const req = {
      headers: { accept: "text/html" },
      method: "GET",
      url: "/guide",
    } as unknown as IncomingMessage;
    let headerSet = false;
    let nexted = false;
    handle(
      req,
      {
        setHeader: () => {
          headerSet = true;
        },
      } as unknown as ServerResponse,
      () => {
        nexted = true;
      }
    );

    expect(req.url).toBe("/guide");
    expect(headerSet).toBe(false);
    expect(nexted).toBe(true);
  });
});

describe("blumeIntegration homepage Link header", () => {
  const LINK = '</llms.txt>; rel="describedby"; type="text/plain"';

  const handleWith = (base?: string): MiddlewareHandle =>
    serverSetup({ base, contentRoutes: ["/"], homeLinkHeader: LINK })[0]
      ?.handle as MiddlewareHandle;

  it("stamps the Link header on homepage requests only", () => {
    const handle = handleWith();
    expect(runHandle(handle, "/").Link).toBe(LINK);
    expect(runHandle(handle, "/?draft=1").Link).toBe(LINK);
    expect(runHandle(handle, "/guide").Link).toBeUndefined();
    expect(runHandle(handle, "/", "POST").Link).toBeUndefined();
  });

  it("matches the homepage under deployment.base, with or without a slash", () => {
    const handle = handleWith("/base/");
    expect(runHandle(handle, "/base").Link).toBe(LINK);
    expect(runHandle(handle, "/base/").Link).toBe(LINK);
    expect(runHandle(handle, "/").Link).toBeUndefined();
    expect(runHandle(handle, "/other/").Link).toBeUndefined();
  });

  it("stamps nothing on a request that carries no url", () => {
    // Node types `IncomingMessage#url` as optional; a url-less request can
    // never be the homepage.
    const handle = handleWith();
    expect(
      runHandle(handle, undefined as unknown as string).Link
    ).toBeUndefined();
  });

  it("sends no Link header when none is configured", () => {
    const handle = serverSetup({ contentRoutes: ["/"] })[0]
      ?.handle as MiddlewareHandle;
    expect(runHandle(handle, "/").Link).toBeUndefined();
  });
});

describe("showBlumeErrorOverlay", () => {
  it("pushes error diagnostics into the dev-server overlay channel", () => {
    let payload: OverlayPayload | undefined;
    serverSetup(
      {},
      {
        ws: {
          send: (p: unknown) => {
            payload = p as OverlayPayload;
          },
        },
      }
    );

    showBlumeErrorOverlay([
      {
        code: "BLUME_CONFIG_INVALID",
        docsUrl: "https://useblume.dev/custom",
        file: "blume.config.ts",
        line: 5,
        message: "bad config",
        severity: "error",
        suggestion: "set it right",
      },
    ]);

    expect(payload).toEqual({
      err: {
        id: "blume.config.ts",
        message:
          "BeDocs found 1 error(s):\n\n[BLUME_CONFIG_INVALID] bad config\n  at blume.config.ts:5\n  fix: set it right\n  docs: https://useblume.dev/custom",
        plugin: "blume",
        stack: "",
      },
      type: "error",
    });
  });

  it("filters out non-errors and omits absent location, fix, and docs", () => {
    let payload: OverlayPayload | undefined;
    serverSetup(
      {},
      {
        // Vite 6+ exposes the HMR channel as `.hot`; the overlay falls back to it.
        hot: {
          send: (p: unknown) => {
            payload = p as OverlayPayload;
          },
        },
      }
    );

    showBlumeErrorOverlay([
      { code: "BLUME_WARN", message: "just a warning", severity: "warning" },
      { code: "BLUME_UNMAPPED", message: "boom", severity: "error" },
    ]);

    expect(payload).toEqual({
      err: {
        // Asserts the overlay payload carries an explicit `id: undefined`;
        // null would change the equality check.
        // oxlint-disable-next-line sonarjs/no-undefined-assignment
        id: undefined,
        message: "BeDocs found 1 error(s):\n\n[BLUME_UNMAPPED] boom",
        plugin: "blume",
        stack: "",
      },
      type: "error",
    });
  });

  it("is a no-op when there are no error diagnostics", () => {
    let sent = false;
    serverSetup(
      {},
      {
        ws: {
          send: () => {
            sent = true;
          },
        },
      }
    );

    showBlumeErrorOverlay([
      { code: "BLUME_WARN", message: "warn", severity: "warning" },
    ]);

    expect(sent).toBe(false);
  });

  it("is a no-op when the dev server exposes no HMR channel", () => {
    serverSetup();
    const diagnostics: Diagnostic[] = [
      { code: "BLUME_UNMAPPED", message: "boom", severity: "error" },
    ];

    expect(() => showBlumeErrorOverlay(diagnostics)).not.toThrow();
  });
});
