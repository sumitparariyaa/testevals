import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findRepoRoot(start = process.cwd()): string {
  let current = resolve(start);

  while (true) {
    if (existsSync(join(current, "data", "schema.json")) && existsSync(join(current, "package.json"))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not find repo root from ${start}`);
    }

    current = parent;
  }
}
