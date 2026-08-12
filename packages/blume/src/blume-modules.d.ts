// Ambient types for Blume's generated virtual modules, so package sources that
// consume them (e.g. the island hooks importing `blume:search-client`) typecheck.
// This file is not part of the published `dist/types` (which is emitted only from
// the public entry points), so it can't leak into a consumer's typecheck; the
// generated `.bedocs/src/env.d.ts` declares the same module for that context.
//
// `import()` types (not a top-level `import`) keep this a global script, so the
// `declare module` stays an ambient declaration visible across the package.

declare module "blume:search-client" {
  /** Create the configured provider's query function (may be async to build). */
  // biome-ignore lint/style/useImportType: ambient module must stay a global script
  // oxlint-disable-next-line typescript/consistent-type-imports
  type Fn = import("./components/layout/search/types.ts").SearchFn;
  export const createSearch: () => Fn | Promise<Fn>;
}

declare module "blume:ask" {
  /** The generated Ask trigger (see `askComponentTemplate`); empty when Ask is off. */
  const Ask: (props: Record<string, unknown>) => unknown;
  export default Ask;
}

declare module "blume:data" {
  /** The generated per-project data snapshot (see `core/data.ts`). */
  // biome-ignore lint/style/useImportType: ambient module must stay a global script
  // oxlint-disable-next-line typescript/consistent-type-imports
  const data: import("./core/data.ts").BlumeData;
  export default data;
}

// Package-only shim so `components/props.ts` can extract `.astro` prop types with
// `ComponentProps<typeof import("./X.astro").default>` under the package's own
// `tsc` (where the Astro TS plugin isn't active). Not shipped in `dist/types`, so
// consumers keep Astro's real `.astro` types and get the true prop shapes.
declare module "*.astro" {
  const component: (props: Record<string, unknown>) => unknown;
  export default component;
}
