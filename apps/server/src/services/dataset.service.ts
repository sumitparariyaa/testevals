import { readFile, readdir } from "node:fs/promises";
import { basename, join } from "node:path";

import type { ClinicalExtraction, DatasetCase } from "@test-evals/shared";

import { findRepoRoot } from "./paths.service";

export async function loadDataset(filter?: string[]): Promise<DatasetCase[]> {
  const root = findRepoRoot();
  const transcriptDir = join(root, "data", "transcripts");
  const goldDir = join(root, "data", "gold");
  const requested = filter ? new Set(filter) : null;
  const files = (await readdir(transcriptDir))
    .filter((file) => file.endsWith(".txt"))
    .sort((left, right) => left.localeCompare(right));
  const cases: DatasetCase[] = [];

  for (const file of files) {
    const id = basename(file, ".txt");
    if (requested && !requested.has(id)) {
      continue;
    }

    const [transcript, goldText] = await Promise.all([
      readFile(join(transcriptDir, file), "utf8"),
      readFile(join(goldDir, `${id}.json`), "utf8"),
    ]);

    cases.push({
      id,
      transcript,
      gold: JSON.parse(goldText) as ClinicalExtraction,
    });
  }

  return cases;
}

export async function loadDatasetCase(id: string): Promise<DatasetCase> {
  const [match] = await loadDataset([id]);
  if (!match) {
    throw new Error(`Dataset case not found: ${id}`);
  }

  return match;
}
