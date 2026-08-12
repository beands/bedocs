import { BUILTIN_MDX_TAGS } from "./builtin-tags.ts";
import type { Diagnostic, PageRecord } from "./types.ts";

/** `CardGroup` → `card-group`, matching registry item names. */
const toKebab = (tag: string): string =>
  tag
    .replaceAll(/(?<lower>[a-z0-9])(?<upper>[A-Z])/gu, "$<lower>-$<upper>")
    .toLowerCase();

/**
 * Warn when an `.mdx` page uses a `<Component>` tag that resolves to nothing —
 * a built-in, an island, or a `components.ts` override — so a typo surfaces as a
 * friendly diagnostic (with a `bedocs add` hint where one exists) instead of a raw
 * MDX "X is not defined" build error. `extraTags` are the project's own known
 * components (islands + overrides); `registryNames` gates the install hint.
 */
export const validateUsedComponents = (
  pages: PageRecord[],
  extraTags: Set<string>,
  registryNames: Set<string>
): Diagnostic[] => {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  for (const page of pages) {
    for (const tag of page.componentsUsed ?? []) {
      if (BUILTIN_MDX_TAGS.has(tag) || extraTags.has(tag) || seen.has(tag)) {
        continue;
      }
      seen.add(tag);
      const name = toKebab(tag);
      const suggestion = registryNames.has(name)
        ? `Run \`bedocs add ${name}\` to install it, or register <${tag}> in components.ts (mdx).`
        : `Register <${tag}> in components.ts (mdx), or add an islands/${tag}.tsx component.`;
      diagnostics.push({
        code: "BLUME_UNKNOWN_COMPONENT",
        file: page.sourcePath ?? page.id,
        message: `<${tag}> is used in ${page.route} but isn't a known component.`,
        severity: "warning",
        suggestion,
      });
    }
  }
  return diagnostics;
};
