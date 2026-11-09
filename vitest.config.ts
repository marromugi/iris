import { existsSync, readdirSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Every directory under these is a project; plain files such as a README are skipped.
const workspaceRoots = ["apps", "packages"];

function projectDirectories(root: string): string[] {
  const path = new URL(`./${root}/`, import.meta.url);
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `${root}/${entry.name}`);
}

export default defineConfig({
  test: {
    projects: workspaceRoots.flatMap(projectDirectories),
  },
});
