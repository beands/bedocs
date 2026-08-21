"use client";

import type { ReactNode } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

import {
  DOCS_CONTENT_W,
  DOCS_HEADER_H,
  DOCS_SIDEBAR_W,
  DOCS_TOC_W,
  DOCS_WIDTH,
  DocsContent,
  DocsHeader,
  DocsSidebar,
  DocsToc,
} from "@/scenes/docs-site";
import { SourceCode } from "@/scenes/source-code";

// A single card telling the whole story in two phases:
//   1. a glassy terminal runs `bedocs init` → `bedocs dev`; the docs site loads.
//   2. the chrome (terminal, header, sidebar, TOC) animates away, the content
//      slides to the right half, and the page's MDX source fades in on the left
//      — a live "markdown in, docs out" split.

const SANS =
  "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif";
const MONO = "var(--font-geist-mono), ui-monospace, SFMono-Regular, monospace";

const INK = "rgba(0,0,0,0.85)";
const MUTED = "rgba(0,0,0,0.55)";
const FAINT = "rgba(0,0,0,0.34)";
const ACCENT = "#009696";
const DIVIDER = "#e1e3e5";

const CARD_W = 1080;
const CARD_H = 604;
const TERMINAL_H = 182;
const CONTENT_H = CARD_H - TERMINAL_H;
const DOCS_SCALE = CARD_W / DOCS_WIDTH;

// Docs-space (1280-wide) geometry.
// full card height, docs-space
const VIEW_H = CARD_H / DOCS_SCALE;
const CONTENT_PANE_W = DOCS_WIDTH - DOCS_SIDEBAR_W - DOCS_TOC_W;
// phase-1 centre
const CONTENT_X1 = DOCS_SIDEBAR_W + (CONTENT_PANE_W - DOCS_CONTENT_W) / 2;
// 50/50 divider
const SPLIT_X = DOCS_WIDTH / 2;
const CONTENT_SCALE2 = 0.88;
// phase-2 right half
const CONTENT_X2 = SPLIT_X + (SPLIT_X - DOCS_CONTENT_W * CONTENT_SCALE2) / 2;

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
// Gentle in-out for the split so the panes ease away instead of jumping.
const SPLIT_EASE = Easing.bezier(0.5, 0, 0.25, 1);
const CHARS_PER_FRAME = 2;

interface TermLine {
  text: string;
  kind: "cmd" | "ok" | "url";
  delay: number;
  pause?: number;
}

const LINES: TermLine[] = [
  { delay: 14, kind: "cmd", text: "npx blume init" },
  { delay: 24, kind: "ok", pause: 6, text: "✓ Created docs/" },
  { delay: 8, kind: "ok", pause: 18, text: "✓ Created blume.config.ts" },
  { delay: 24, kind: "cmd", text: "bedocs dev" },
  { delay: 18, kind: "url", text: "→ running on localhost:4321" },
];

const computeStarts = (lines: TermLine[]): number[] => {
  const starts: number[] = [];
  let acc = 18;
  for (const line of lines) {
    acc += line.delay;
    starts.push(acc);
    acc += Math.ceil(line.text.length / CHARS_PER_FRAME) + (line.pause ?? 0);
  }
  return starts;
};

const STARTS = computeStarts(LINES);
const LAST = LINES.length - 1;
const DEV_READY =
  STARTS[LAST] + Math.ceil(LINES[LAST].text.length / CHARS_PER_FRAME);
const LOAD = DEV_READY + 4;
// Phase 1 settles (docs loaded) around frame 207; hold briefly, then split.
const SPLIT_START = 240;
const SPLIT_DUR = 60;
// Post-split autoscroll: a steady docs-space velocity that kicks in once the
// split has settled. Constant speed (not eased toward a fixed target) so both
// panes are still visibly moving when the scene cuts away — no crawl-to-a-stop.
const SCROLL_START = SPLIT_START + SPLIT_DUR + 12;
const SCROLL_SPEED = 8;
// The centre divider holds off until the content has slid clear of the middle
// (near the end of the split), then draws top-down rather than fading through.
const DIVIDER_START = SPLIT_START + SPLIT_DUR - 4;
const DIVIDER_DUR = 24;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

const Segments = ({
  segments,
  revealed,
}: {
  segments: [string, string][];
  revealed: number;
}) => (
  <>
    {segments.map(([text, color], i) => {
      // Chars consumed by earlier segments — derived, never reassigned mid-render.
      const start = segments
        .slice(0, i)
        .reduce((acc, [prev]) => acc + prev.length, 0);
      const remaining = revealed - start;
      if (remaining <= 0) {
        return null;
      }
      return (
        <span key={text} style={{ color }}>
          {text.slice(0, remaining)}
        </span>
      );
    })}
  </>
);

const urlSegments = (text: string): [string, string][] => {
  const idx = text.indexOf("localhost");
  if (idx === -1) {
    return [[text, MUTED]];
  }
  return [
    ["→ ", ACCENT],
    [text.slice(2, idx), MUTED],
    [text.slice(idx), ACCENT],
  ];
};

// oxlint-disable-next-line react-doctor/no-giant-component -- splitting this working Remotion scene risks the tightly choreographed render; not worth it
export const DevPreview = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const cardOpacity = interpolate(frame, [0, 14], [0, 1], clamp);
  const cardScale = interpolate(frame, [0, 20], [0.985, 1], {
    ...clamp,
    easing: EASE,
  });
  const cardY = interpolate(frame, [0, 20], [18, 0], {
    ...clamp,
    easing: EASE,
  });

  // Docs load-in.
  const docsOpacity = interpolate(frame, [LOAD, LOAD + 18], [0, 1], clamp);
  const loadSlide = interpolate(frame, [LOAD, LOAD + 26], [26, 0], {
    ...clamp,
    easing: EASE,
  });

  // Split transition (0 → 1), then a steady scroll of both panes in lockstep.
  const split = interpolate(
    frame,
    [SPLIT_START, SPLIT_START + SPLIT_DUR],
    [0, 1],
    { ...clamp, easing: SPLIT_EASE }
  );
  // Constant velocity — both panes are tall enough that neither bottoms out
  // before the cut, so the motion never pauses. Left and right scroll together.
  const p2Scroll = -Math.max(0, frame - SCROLL_START) * SCROLL_SPEED;

  // Per-element choreography — linear on the (already eased) split progress.
  const headerY =
    loadSlide + interpolate(split, [0, 1], [0, -(DOCS_HEADER_H + 6)]);
  const headerFade = interpolate(split, [0, 0.6], [1, 0], clamp);
  const sideX = interpolate(split, [0, 1], [0, -(DOCS_SIDEBAR_W + 40)], clamp);
  const tocX = interpolate(split, [0, 1], [0, DOCS_TOC_W + 40], clamp);
  const chromeFade = interpolate(split, [0, 0.65], [1, 0], clamp);

  const contentX = interpolate(split, [0, 1], [CONTENT_X1, CONTENT_X2], clamp);
  const contentY =
    loadSlide +
    interpolate(split, [0, 1], [DOCS_HEADER_H + 8, 24], clamp) +
    p2Scroll;
  const contentScale = interpolate(split, [0, 1], [1, CONTENT_SCALE2], clamp);

  const sourceOpacity = interpolate(split, [0.5, 1], [0, 1], clamp);
  const sourceX = interpolate(split, [0.5, 1], [-24, 0], clamp);
  // Top-down draw (0 → 1), gated on frame so it lands after the split settles.
  const dividerDraw = interpolate(
    frame,
    [DIVIDER_START, DIVIDER_START + DIVIDER_DUR],
    [0, 1],
    { ...clamp, easing: EASE }
  );

  const viewportH = interpolate(split, [0, 0.85], [CONTENT_H, CARD_H], clamp);
  const termOut = interpolate(split, [0, 1], [0, TERMINAL_H + 40], clamp);
  const termFade = interpolate(split, [0, 0.6], [1, 0], clamp);

  const cursorOn = Math.floor((frame / fps) * 2) % 2 === 0;
  let activeIndex = -1;
  for (const [i, start] of STARTS.entries()) {
    if (frame >= start) {
      activeIndex = i;
    }
  }

  const terminalStyle = {
    // oxlint-disable-next-line react-doctor/no-large-animated-blur -- intentional video visual — frosted-glass blur radius tuned for launch render
    WebkitBackdropFilter: "blur(22px)",
    // oxlint-disable-next-line react-doctor/no-large-animated-blur -- intentional video visual — frosted-glass blur radius tuned for launch render
    backdropFilter: "blur(22px)",
    background: "rgba(255,255,255,0.4)",
    borderTop: "1px solid rgba(120,130,150,0.18)",
    display: "flex",
    flexDirection: "column",
    height: TERMINAL_H,
    left: 0,
    opacity: termFade,
    position: "absolute",
    top: CONTENT_H,
    transform: `translateY(${termOut}px)`,
    width: CARD_W,
  } as const;

  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center" }}>
      <div
        style={{
          borderRadius: 20,
          boxShadow:
            "0 40px 100px rgba(35,40,60,0.28), 0 0 0 1px rgba(255,255,255,0.55)",
          height: CARD_H,
          opacity: cardOpacity,
          overflow: "hidden",
          transform: `translateY(${cardY}px) scale(${cardScale})`,
          width: CARD_W,
        }}
      >
        {/* Docs viewport — grows to fill the card as the terminal leaves */}
        <div
          style={{
            background: "#fff",
            height: viewportH,
            left: 0,
            overflow: "hidden",
            position: "absolute",
            top: 0,
            width: CARD_W,
          }}
        >
          <div
            style={{
              left: 0,
              position: "absolute",
              top: 0,
              transform: `scale(${DOCS_SCALE})`,
              transformOrigin: "top left",
              width: DOCS_WIDTH,
            }}
          >
            {/* Source code (fades in on the left half) */}
            <div
              style={{
                height: VIEW_H,
                left: 0,
                opacity: docsOpacity * sourceOpacity,
                position: "absolute",
                top: 0,
                transform: `translate(${sourceX}px, ${p2Scroll}px)`,
                width: SPLIT_X,
              }}
            >
              <SourceCode fontSize={17} />
            </div>

            {/* Rendered content (centre → right half) */}
            <div
              style={{
                left: 0,
                opacity: docsOpacity,
                position: "absolute",
                top: 0,
                transform: `translate(${contentX}px, ${contentY}px) scale(${contentScale})`,
                transformOrigin: "top left",
                width: DOCS_CONTENT_W,
              }}
            >
              <DocsContent />
            </div>

            {/* Sidebar (slides out left) */}
            <div
              style={{
                height: VIEW_H - DOCS_HEADER_H,
                left: 0,
                opacity: docsOpacity * chromeFade,
                position: "absolute",
                top: DOCS_HEADER_H,
                transform: `translate(${sideX}px, ${loadSlide}px)`,
                width: DOCS_SIDEBAR_W,
              }}
            >
              <DocsSidebar />
            </div>

            {/* TOC (slides out right) */}
            <div
              style={{
                height: VIEW_H - DOCS_HEADER_H,
                left: DOCS_WIDTH - DOCS_TOC_W,
                opacity: docsOpacity * chromeFade,
                position: "absolute",
                top: DOCS_HEADER_H,
                transform: `translate(${tocX}px, ${loadSlide}px)`,
                width: DOCS_TOC_W,
              }}
            >
              <DocsToc />
            </div>

            {/* Centre divider — waits for the split to clear, then draws top-down */}
            <div
              style={{
                background: DIVIDER,
                height: VIEW_H * dividerDraw,
                left: SPLIT_X,
                opacity: interpolate(dividerDraw, [0, 0.12], [0, 1], clamp),
                position: "absolute",
                top: 0,
                width: 1.6,
              }}
            />

            {/* Header (pinned, then slides up out) — last so it sits on top */}
            <div
              style={{
                left: 0,
                opacity: docsOpacity * headerFade,
                position: "absolute",
                top: 0,
                transform: `translateY(${headerY}px)`,
                width: DOCS_WIDTH,
              }}
            >
              <DocsHeader />
            </div>
          </div>
        </div>

        {/* Terminal — frosted glass; slides out the bottom during the split */}
        <div style={terminalStyle}>
          <div
            style={{
              alignItems: "center",
              display: "flex",
              justifyContent: "space-between",
              padding: "12px 22px 8px",
            }}
          >
            <span
              style={{
                color: INK,
                fontFamily: SANS,
                fontSize: 14,
                fontWeight: 600,
              }}
            >
              Terminal
            </span>
            <span style={{ color: FAINT, fontFamily: MONO, fontSize: 13 }}>
              ~/acme
            </span>
          </div>
          <div
            style={{
              fontFamily: MONO,
              fontSize: 14.5,
              lineHeight: "23px",
              padding: "0 22px",
            }}
          >
            {LINES.map((line, i) => {
              if (frame < STARTS[i]) {
                return null;
              }
              const local = frame - STARTS[i];
              const revealed = Math.min(
                line.text.length,
                Math.floor(local * CHARS_PER_FRAME)
              );
              const typing = revealed < line.text.length;
              const showCursor = i === activeIndex && typing && cursorOn;

              let cmdBody: ReactNode;
              if (line.kind === "cmd") {
                cmdBody = (
                  <>
                    <span style={{ color: ACCENT, marginRight: 8 }}>$</span>
                    <span style={{ color: INK }}>
                      {line.text.slice(0, revealed)}
                    </span>
                  </>
                );
              } else if (line.kind === "url") {
                cmdBody = (
                  <Segments
                    segments={urlSegments(line.text)}
                    revealed={revealed}
                  />
                );
              } else {
                cmdBody = (
                  <Segments
                    segments={[
                      [line.text.slice(0, 1), ACCENT],
                      [line.text.slice(1), MUTED],
                    ]}
                    revealed={revealed}
                  />
                );
              }

              return (
                <div
                  key={line.text}
                  style={{
                    alignItems: "center",
                    display: "flex",
                    whiteSpace: "pre",
                  }}
                >
                  {cmdBody}
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
            })}
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
