"use client";

import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// The two agent-ready terminal scenes, sharing one frosted-card renderer:
//   AgentCurl — an agent's-eye view of the front door: `curl -I` shows the
//   discovery Link headers, then `Accept: text/markdown` gets a page back as
//   Markdown (both real responses from a deployed Blume site).
//   AgentBuild — `bedocs build` emits the whole discovery layer (the real
//   logger.success lines), then `tree dist/.well-known` shows what landed.

const MONO = "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace";

const INK = "rgba(0,0,0,0.85)";
const MUTED = "rgba(0,0,0,0.55)";
const FAINT = "rgba(0,0,0,0.34)";
const ACCENT = "#009696";
const GREEN = "#1a9950";
const CHROME_BORDER = "rgba(90,100,120,0.14)";

const CARD_W = 960;
const CARD_H = 564;
const CHROME_H = 40;
const PAD_X = 26;
const PAD_TOP = 12;
const PAD_BOTTOM = 18;
const LINE_H = 23;
const VIEW_H = CARD_H - CHROME_H - PAD_TOP - PAD_BOTTOM;

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const CHARS_PER_FRAME = 2;
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

interface TermLine {
  kind:
    | "cmd"
    | "blank"
    /** HTTP status line — ink, semibold. */
    | "status"
    /** Plain response header — dim name, muted value split on `meta`. */
    | "hdr"
    /** A discovery Link header — muted target, accent rel in `meta`. */
    | "link"
    /** Markdown body tones. */
    | "fm"
    | "h1"
    | "body"
    /** Build success line — green ✔. */
    | "ok"
    /** `tree` output — faint glyphs, `meta` carries the entry name. */
    | "tree";
  text?: string;
  /** hdr: the value; link: the rel params; tree: the entry name. */
  meta?: string;
  /** tree: directories render ink instead of muted. */
  strong?: boolean;
  /** Frames after the previous line finishes before this one lands. */
  delay: number;
  /** Extra hold after this line, before the next starts. */
  pause?: number;
}

// Scene 1's script — the front door. Header shapes mirror what a deployed
// Blume site actually sends (deploy/headers.ts + ai/link-headers.ts), and the
// negotiated body is the `.md` mirror (astro/markdown-negotiation.ts).
const CURL_LINES: TermLine[] = [
  { delay: 16, kind: "cmd", text: "curl -I https://acme.dev" },
  { delay: 8, kind: "status", text: "HTTP/2 200" },
  {
    delay: 2,
    kind: "hdr",
    meta: "text/html; charset=utf-8",
    text: "content-type:",
  },
  {
    delay: 2,
    kind: "link",
    meta: 'rel="api-catalog"',
    text: "link: </.well-known/api-catalog>;",
  },
  {
    delay: 2,
    kind: "link",
    meta: 'rel="describedby"',
    text: "link: </agent-readability.json>;",
  },
  {
    delay: 2,
    kind: "link",
    meta: 'rel="describedby"',
    text: "link: </llms.txt>;",
  },
  { delay: 2, kind: "hdr", meta: "Accept", pause: 18, text: "vary:" },
  { delay: 6, kind: "blank" },
  {
    delay: 0,
    kind: "cmd",
    text: 'curl https://acme.dev/quickstart -H "Accept: text/markdown"',
  },
  { delay: 8, kind: "fm", text: "---" },
  { delay: 2, kind: "fm", text: "title: Quickstart" },
  {
    delay: 2,
    kind: "fm",
    text: "description: Install Acme and make your first call.",
  },
  { delay: 2, kind: "fm", text: "---" },
  { delay: 2, kind: "blank" },
  { delay: 0, kind: "h1", text: "# Quickstart" },
  { delay: 2, kind: "blank" },
  {
    delay: 0,
    kind: "body",
    text: "Install the CLI with your package manager:",
  },
];

// Scene 2's script — the build. The ✔ lines are the real `logger.success`
// strings the CLI prints; the tree is the `.well-known` directory it leaves
// in dist.
const BUILD_LINES: TermLine[] = [
  { delay: 16, kind: "cmd", text: "bedocs build" },
  { delay: 10, kind: "blank" },
  { delay: 0, kind: "ok", text: "Generated llms.txt and llms-full.txt" },
  { delay: 4, kind: "ok", text: "Generated agent-readability.json" },
  {
    delay: 4,
    kind: "ok",
    text: "Generated .well-known/api-catalog (RFC 9727)",
  },
  {
    delay: 4,
    kind: "ok",
    text: "Generated .well-known/http-message-signatures-directory (Web Bot Auth)",
  },
  {
    delay: 4,
    kind: "ok",
    text: "Published 1 agent skill (.well-known/agent-skills/index.json)",
  },
  {
    delay: 4,
    kind: "ok",
    text: "Wired Accept: text/markdown negotiation into the routing config",
  },
  { delay: 6, kind: "ok", pause: 16, text: "Built to dist" },
  { delay: 6, kind: "blank" },
  { delay: 0, kind: "cmd", text: "tree dist/.well-known" },
  { delay: 8, kind: "tree", meta: "dist/.well-known", strong: true, text: "" },
  { delay: 2, kind: "tree", meta: "agent-skills", strong: true, text: "├── " },
  { delay: 2, kind: "tree", meta: "acme.tar.gz", text: "│   ├── " },
  { delay: 2, kind: "tree", meta: "index.json", text: "│   └── " },
  { delay: 2, kind: "tree", meta: "api-catalog", text: "├── " },
  {
    delay: 2,
    kind: "tree",
    meta: "http-message-signatures-directory",
    text: "├── ",
  },
  { delay: 2, kind: "tree", meta: "mcp", strong: true, text: "├── " },
  { delay: 2, kind: "tree", meta: "server-card.json", text: "│   └── " },
  { delay: 2, kind: "tree", meta: "mcp.json", text: "└── " },
];

/** Frames a line spends arriving: cmd lines type, output lines just land. */
const arrival = (line: TermLine): number =>
  line.kind === "cmd"
    ? Math.ceil((line.text?.length ?? 0) / CHARS_PER_FRAME)
    : 0;

interface TermScript {
  duration: number;
  lines: TermLine[];
  scrollSteps: { start: number; delta: number }[];
  starts: number[];
}

// Compile a script: absolute start frames, total duration, and the terminal
// scroll — once the content outgrows the viewport, each new line eases the
// buffer up just far enough to stay visible (monotonic by construction).
const makeScript = (lines: TermLine[], tailHold: number): TermScript => {
  const starts: number[] = [];
  let acc = 14;
  for (const line of lines) {
    acc += line.delay;
    starts.push(acc);
    acc += arrival(line) + (line.pause ?? 0);
  }

  const scrollSteps: { start: number; delta: number }[] = [];
  let target = 0;
  let bottom = 0;
  for (const start of starts) {
    bottom += LINE_H;
    const next = Math.max(target, bottom - VIEW_H);
    if (next > target) {
      scrollSteps.push({ delta: next - target, start });
      target = next;
    }
  }

  return { duration: acc + tailHold, lines, scrollSteps, starts };
};

const CURL_SCRIPT = makeScript(CURL_LINES, 76);
const BUILD_SCRIPT = makeScript(BUILD_LINES, 76);

export const AGENT_CURL_DURATION = CURL_SCRIPT.duration;
export const AGENT_BUILD_DURATION = BUILD_SCRIPT.duration;

const TrafficLight = ({ color }: { color: string }) => (
  <span
    style={{
      background: color,
      borderRadius: 999,
      display: "inline-block",
      height: 11,
      width: 11,
    }}
  />
);

const LineBody = ({ line }: { line: TermLine }) => {
  switch (line.kind) {
    case "blank": {
      return null;
    }
    case "status": {
      return <span style={{ color: INK, fontWeight: 600 }}>{line.text}</span>;
    }
    case "hdr": {
      return (
        <>
          <span style={{ color: FAINT }}>{line.text}</span>
          <span style={{ color: MUTED }}>{` ${line.meta}`}</span>
        </>
      );
    }
    case "link": {
      return (
        <>
          <span style={{ color: MUTED }}>{line.text}</span>
          <span style={{ color: ACCENT }}>{` ${line.meta}`}</span>
        </>
      );
    }
    case "fm": {
      return <span style={{ color: FAINT }}>{line.text}</span>;
    }
    case "h1": {
      return <span style={{ color: INK, fontWeight: 600 }}>{line.text}</span>;
    }
    case "body": {
      return <span style={{ color: MUTED }}>{line.text}</span>;
    }
    case "ok": {
      return (
        <>
          <span style={{ color: GREEN }}>{"✔ "}</span>
          <span style={{ color: MUTED }}>{line.text}</span>
        </>
      );
    }
    case "tree": {
      return (
        <>
          <span style={{ color: FAINT }}>{line.text}</span>
          <span
            style={{
              color: line.strong ? INK : MUTED,
              fontWeight: line.strong ? 600 : 400,
            }}
          >
            {line.meta}
          </span>
        </>
      );
    }
    default: {
      return null;
    }
  }
};

const TerminalCard = ({ script }: { script: TermScript }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { lines, scrollSteps, starts } = script;

  const cardOpacity = interpolate(frame, [0, 14], [0, 1], clamp);
  const cardScale = interpolate(frame, [0, 20], [0.985, 1], {
    ...clamp,
    easing: EASE,
  });
  const cardY = interpolate(frame, [0, 20], [18, 0], {
    ...clamp,
    easing: EASE,
  });

  const scroll = scrollSteps.reduce(
    (acc, step) =>
      acc +
      interpolate(frame, [step.start, step.start + 16], [0, step.delta], {
        ...clamp,
        easing: EASE,
      }),
    0
  );

  const cursorOn = Math.floor((frame / fps) * 2) % 2 === 0;
  let activeIndex = -1;
  for (const [i, start] of starts.entries()) {
    if (frame >= start) {
      activeIndex = i;
    }
  }

  const cardStyle = {
    // oxlint-disable-next-line react-doctor/no-large-animated-blur -- intentional video visual — frosted-glass blur radius tuned for launch render
    WebkitBackdropFilter: "blur(16px)",
    // oxlint-disable-next-line react-doctor/no-large-animated-blur -- intentional video visual — frosted-glass blur radius tuned for launch render
    backdropFilter: "blur(16px)",
    background: "rgba(255,255,255,0.82)",
    border: "1px solid rgba(255,255,255,0.85)",
    borderRadius: 14,
    boxShadow:
      "0 30px 70px rgba(30,40,60,0.24), inset 0 1px 0 rgba(255,255,255,0.8)",
    height: CARD_H,
    opacity: cardOpacity,
    overflow: "hidden",
    transform: `translateY(${cardY}px) scale(${cardScale})`,
    width: CARD_W,
  } as const;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div style={cardStyle}>
        {/* terminal chrome */}
        <div
          style={{
            alignItems: "center",
            borderBottom: `1px solid ${CHROME_BORDER}`,
            display: "flex",
            gap: 8,
            height: CHROME_H,
            padding: "0 16px",
            position: "relative",
          }}
        >
          <TrafficLight color="#ff5f57" />
          <TrafficLight color="#febc2e" />
          <TrafficLight color="#28c840" />
          <div
            style={{
              color: MUTED,
              fontFamily: MONO,
              fontSize: 13,
              left: 0,
              position: "absolute",
              right: 0,
              textAlign: "center",
            }}
          >
            ~/acme
          </div>
        </div>

        {/* scrolling buffer */}
        <div
          style={{
            height: VIEW_H,
            marginTop: PAD_TOP,
            overflow: "hidden",
            padding: `0 ${PAD_X}px`,
          }}
        >
          <div
            style={{
              fontFamily: MONO,
              fontSize: 14.5,
              lineHeight: `${LINE_H}px`,
              transform: `translateY(${-scroll}px)`,
            }}
          >
            {lines.map((line, i) => {
              if (frame < starts[i]) {
                return null;
              }
              const local = frame - starts[i];
              const landed = interpolate(local, [0, 4], [0, 1], clamp);

              if (line.kind === "cmd") {
                const revealed = Math.min(
                  line.text?.length ?? 0,
                  Math.floor(local * CHARS_PER_FRAME)
                );
                const typing = revealed < (line.text?.length ?? 0);
                const showCursor = i === activeIndex && typing && cursorOn;
                return (
                  <div
                    key={`${line.kind}-${i}`}
                    style={{
                      alignItems: "center",
                      display: "flex",
                      height: LINE_H,
                      whiteSpace: "pre",
                    }}
                  >
                    <span style={{ color: ACCENT, marginRight: 8 }}>$</span>
                    <span style={{ color: INK }}>
                      {line.text?.slice(0, revealed)}
                    </span>
                    {showCursor && (
                      <span
                        style={{
                          background: INK,
                          display: "inline-block",
                          height: 15,
                          marginLeft: 2,
                          transform: "translateY(2px)",
                          width: 8,
                        }}
                      />
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={`${line.kind}-${i}`}
                  style={{
                    height: LINE_H,
                    opacity: landed,
                    whiteSpace: "pre",
                  }}
                >
                  <LineBody line={line} />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const AgentCurl = () => <TerminalCard script={CURL_SCRIPT} />;
export const AgentBuild = () => <TerminalCard script={BUILD_SCRIPT} />;
