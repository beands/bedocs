import { resolve, sep } from "node:path";

const PROJECT_NAME_RE = /^[a-z0-9-]{1,64}$/;
const FILE_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}\.(md|mdx)$/;

export function isValidProjectName(name) {
  return typeof name === "string" && PROJECT_NAME_RE.test(name);
}

export function isValidDocFileName(name) {
  return (
    typeof name === "string" &&
    FILE_NAME_RE.test(name) &&
    !name.includes("..") &&
    !name.includes("/") &&
    !name.includes("\\")
  );
}

// Defense in depth: the resolved path must stay inside `root`.
export function safeJoin(root, ...segments) {
  const target = resolve(root, ...segments);
  const rootResolved = resolve(root);
  if (target !== rootResolved && !target.startsWith(rootResolved + sep)) {
    return null;
  }
  return target;
}
