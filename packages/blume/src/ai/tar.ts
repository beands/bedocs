import { gzipSync } from "node:zlib";

import { createTar } from "nanotar";

/**
 * `.tar.gz` writer for agent-skill archives, on nanotar's ustar writer.
 * Deterministic by construction — fixed mtime/uid/gid/owner attrs,
 * caller-ordered entries, and Node's gzip header carries no timestamp — so a
 * skill's archive digest only changes when its content does. That holds per
 * machine: the tar bytes are portable, but zlib's compressed stream differs
 * across architectures, so gzip-layer digests are not comparable across
 * platforms.
 */

/** One regular file to archive. Paths are `/`-separated, relative, no `..`. */
export interface TarEntry {
  /** Raw file bytes. */
  content: Uint8Array;
  /** Preserve the owner-execute bit (e.g. a skill's scripts). */
  executable?: boolean;
  /** Archive-relative path, e.g. `SKILL.md` or `references/FORMS.md`. */
  path: string;
}

/** ustar `name` field capacity; skill layouts are shallow, so no `prefix`. */
const NAME_MAX = 100;

const encoder = new TextEncoder();

/**
 * Build a gzipped ustar archive of the given files, in the given order. Paths
 * longer than the ustar `name` field or escaping the archive root throw to
 * surface a programming error — nanotar would silently truncate an oversized
 * name into a corrupt archive, so the validation stays here.
 */
export const buildTarGz = (entries: readonly TarEntry[]): Uint8Array => {
  for (const entry of entries) {
    if (encoder.encode(entry.path).byteLength > NAME_MAX) {
      throw new Error(`tar path exceeds ${NAME_MAX} bytes: ${entry.path}`);
    }
    if (entry.path.startsWith("/") || entry.path.split("/").includes("..")) {
      throw new Error(`tar path must be archive-relative: ${entry.path}`);
    }
  }
  const tar = createTar(
    entries.map((entry) => ({
      // Root-owned, epoch-mtime, empty owner names: every field a rebuild
      // could vary is pinned so the archive bytes are a function of content.
      attrs: {
        gid: 0,
        group: "",
        mode: entry.executable ? "755" : "644",
        mtime: 0,
        uid: 0,
        user: "",
      },
      data: entry.content,
      name: entry.path,
    }))
  );
  // Sync gzip with a pinned level; Node writes no timestamp into the header.
  return new Uint8Array(gzipSync(tar, { level: 9 }));
};
