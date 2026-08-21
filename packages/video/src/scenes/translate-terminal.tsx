"use client";

import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

// The two translate frosted-card scenes, sharing one card frame so the config
// cuts to the terminal without the stage changing shape:
//   TranslateConfig — the `i18n` block lands in blume.config.ts, line by line.
//   TranslateRun — `bedocs translate --codex` streams the per-item results
//   (glyph, `source → locale`, time, spend — exactly the shape the real CLI
//   prints from itemEndLine in packages/blume/src/translate/report.ts).

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

// ─── The config file ────────────────────────────────────────────────────────
// An `i18n` block in the real blume.config.ts shape — the same four locales
// the terminal fills in next scene, per-locale style notes included.

interface Token {
  text: string;
  color: string;
}

/** Keyword / identifier — the accent the yaml card gives keys. */
const kw = (text: string): Token => ({ color: ACCENT, text });
/** Plain identifier or value. */
const id = (text: string): Token => ({ color: INK, text });
/** String literal. */
const str = (text: string): Token => ({ color: MUTED, text: `"${text}"` });
/** Punctuation and structure. */
const p = (text: string): Token => ({ color: FAINT, text });

const localeLine = (code: string, label: string, style?: string): Token[] => [
  p("      { "),
  kw("code"),
  p(": "),
  str(code),
  p(", "),
  kw("label"),
  p(": "),
  str(label),
  ...(style ? [p(", "), kw("style"), p(": "), str(style)] : []),
  p(" },"),
];

const CONFIG_LINES: Token[][] = [
  [
    kw("import"),
    p(" { "),
    id("defineConfig"),
    p(" } "),
    kw("from"),
    p(" "),
    str("blume"),
    p(";"),
  ],
  [],
  [kw("export default"), p(" "), id("defineConfig"), p("({")],
  [p("  "), kw("i18n"), p(": {")],
  [p("    "), kw("defaultLocale"), p(": "), str("en"), p(",")],
  [p("    "), kw("locales"), p(": [")],
  localeLine("en", "English"),
  localeLine("de", "Deutsch", "Informal du-form"),
  localeLine("es", "Español", "Latin American Spanish"),
  localeLine("ja", "日本語", "Polite です/ます form"),
  localeLine("zh", "中文", "Simplified Chinese"),
  [p("    ],")],
  [p("  },")],
  [p("});")],
];

// Card entry (14) + one landing beat per line + a short hold on the finished
// file — the locale list is the whole point, so it gets a beat, not a dwell.
const CONFIG_STAGGER = 3;
export const TRANSLATE_CONFIG_DURATION =
  14 + CONFIG_LINES.length * CONFIG_STAGGER + 40;

// ─── The terminal run ───────────────────────────────────────────────────────

interface TermLine {
  kind: "cmd" | "blank" | "header" | "item" | "summary";
  text?: string;
  /** header: the dim `items · locales · agent` tail. */
  meta?: string;
  /** item lines: the source page (or batched meta-titles label). */
  source?: string;
  /** item lines: the target locale after the arrow. */
  locale?: string;
  /** item lines: the dim wall clock / spend cells. */
  time?: string;
  cost?: string;
  /** Frames after the previous line finishes before this one lands. */
  delay: number;
  /** Extra hold after this line, before the next starts. */
  pause?: number;
}

const HEADER_META = "16 item(s) · 4 locale(s) · Codex";
// Counts that add up: 12 page items + 4 batched meta items = the 16 in the
// header; the spend is the per-item cells summed, the wall clock is the item
// times spread across the four concurrent lanes.
const SUMMARY =
  "Translated 16 files into 4 locales · 3 adopted · 112 already up to date · 2m 24s · $1.65";

// The script. Copy mirrors itemEndLine / translateSummaryLine in
// packages/blume/src/translate/report.ts — real line shapes, with lanes
// finishing out of order the way the concurrent worker pool actually does.
const item = (
  source: string,
  locale: string,
  time: string,
  cost: string,
  delay: number
): TermLine => ({ cost, delay, kind: "item", locale, source, time });

const RUN_LINES: TermLine[] = [
  { delay: 16, kind: "cmd", text: "bedocs translate --codex" },
  { delay: 10, kind: "blank" },
  { delay: 0, kind: "header", meta: HEADER_META },
  { delay: 4, kind: "blank" },
  item("docs/quickstart.mdx", "es", "36.1s", "$0.10", 12),
  item("docs/quickstart.mdx", "de", "38.4s", "$0.11", 8),
  item("docs/quickstart.mdx", "zh", "41.9s", "$0.12", 8),
  item("docs/quickstart.mdx", "ja", "47.2s", "$0.14", 10),
  item("docs/guides/deploy.mdx", "es", "40.3s", "$0.12", 8),
  item("docs/guides/deploy.mdx", "de", "44.8s", "$0.13", 8),
  item("docs/reference/cli.mdx", "de", "37.7s", "$0.11", 10),
  item("docs/guides/deploy.mdx", "zh", "49.5s", "$0.15", 8),
  item("docs/reference/cli.mdx", "es", "39.8s", "$0.12", 8),
  item("docs/guides/deploy.mdx", "ja", "52.6s", "$0.16", 8),
  item("docs/reference/cli.mdx", "zh", "43.2s", "$0.13", 8),
  item("docs/reference/cli.mdx", "ja", "46.9s", "$0.14", 10),
  item("meta titles (4)", "de", "9.8s", "$0.03", 6),
  item("meta titles (4)", "es", "10.4s", "$0.03", 4),
  item("meta titles (4)", "ja", "11.2s", "$0.03", 4),
  item("meta titles (4)", "zh", "9.1s", "$0.03", 4),
  { delay: 6, kind: "blank" },
  { delay: 0, kind: "summary", text: SUMMARY },
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

const RUN_SCRIPT = makeScript(RUN_LINES, 76);

export const TRANSLATE_RUN_DURATION = RUN_SCRIPT.duration;

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

// The shared frosted card: chrome bar (traffic lights, centered title) over a
// clipped content viewport, entering with the same fade/lift both scenes use.
const FrostedCard = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => {
  const frame = useCurrentFrame();

  const cardOpacity = interpolate(frame, [0, 14], [0, 1], clamp);
  const cardScale = interpolate(frame, [0, 20], [0.985, 1], {
    ...clamp,
    easing: EASE,
  });
  const cardY = interpolate(frame, [0, 20], [18, 0], {
    ...clamp,
    easing: EASE,
  });

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
            {title}
          </div>
        </div>
        <div
          style={{
            height: VIEW_H,
            marginTop: PAD_TOP,
            overflow: "hidden",
            padding: `0 ${PAD_X}px`,
          }}
        >
          {children}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── TranslateConfig ────────────────────────────────────────────────────────
export const TranslateConfig = () => {
  const frame = useCurrentFrame();

  return (
    <FrostedCard title="blume.config.ts">
      <div
        style={{ fontFamily: MONO, fontSize: 14.5, lineHeight: `${LINE_H}px` }}
      >
        {CONFIG_LINES.map((tokens, i) => {
          const start = 14 + i * CONFIG_STAGGER;
          if (frame < start) {
            return null;
          }
          const landed = interpolate(frame - start, [0, 4], [0, 1], clamp);
          return (
            <div
              // oxlint-disable-next-line react/no-array-index-key -- static script; lines never reorder
              key={i}
              style={{ height: LINE_H, opacity: landed, whiteSpace: "pre" }}
            >
              {tokens.map((token, j) => (
                <span
                  // oxlint-disable-next-line react/no-array-index-key -- static script; tokens never reorder
                  key={j}
                  style={{ color: token.color }}
                >
                  {token.text}
                </span>
              ))}
            </div>
          );
        })}
      </div>
    </FrostedCard>
  );
};

// ─── TranslateRun ───────────────────────────────────────────────────────────
const LineBody = ({ line }: { line: TermLine }) => {
  switch (line.kind) {
    case "blank": {
      return null;
    }
    case "header": {
      return (
        <>
          <span style={{ color: INK, fontWeight: 600 }}>
            {"  blume translate"}
          </span>
          <span style={{ color: FAINT }}>{`  ${line.meta}`}</span>
        </>
      );
    }
    case "item": {
      return (
        <>
          <span style={{ color: GREEN }}>{"  ✔ "}</span>
          <span style={{ color: INK }}>{line.source}</span>
          <span style={{ color: MUTED }}>{" → "}</span>
          <span style={{ color: INK }}>{line.locale}</span>
          <span style={{ color: FAINT }}>{` ${line.time} ${line.cost}`}</span>
        </>
      );
    }
    case "summary": {
      return <span style={{ color: MUTED }}>{`  ${line.text}`}</span>;
    }
    default: {
      return null;
    }
  }
};

export const TranslateRun = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { lines, scrollSteps, starts } = RUN_SCRIPT;

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

  return (
    <FrostedCard title="~/acme">
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
    </FrostedCard>
  );
};
