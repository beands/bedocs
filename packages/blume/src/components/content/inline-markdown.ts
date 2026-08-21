/**
 * Shared helpers for components that render a short Markdown prop (a caption,
 * a description, a tooltip label) into inline HTML injected via `set:html`.
 * Previously copied verbatim into Prompt, Frame, and Tooltip.
 */

/**
 * Neutralize raw HTML in a Markdown-rendered text prop by escaping only
 * `<`/`>`. `&` deliberately stays: CommonMark already renders a bare `&` as
 * `&amp;` and resolves real entity references, so leaving it alone keeps
 * `&copy;`-style authoring working — a full HTML escape would render it as
 * the literal text `&copy;`.
 */
export const escapeRawHtml = (value: string): string =>
  value.replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/**
 * Unwrap the `<p>` a block-level Markdown render wraps around single-line
 * content, so it can sit inside inline markup. Only a *single* paragraph is
 * unwrapped: the content must not contain its own `</p>`, or
 * `<p>a</p>\n<p>b</p>` would "unwrap" to `a</p>\n<p>b` — unbalanced HTML
 * injected via `set:html`.
 */
export const unwrapParagraph = (html: string): string => {
  const trimmed = html.trim();
  const match = trimmed.match(/^<p>(?<content>(?:(?!<\/p>)[\s\S])*)<\/p>$/u);
  return match?.groups?.content ?? trimmed;
};
