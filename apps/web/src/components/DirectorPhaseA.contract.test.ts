import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./DirectorWorkspace.tsx", import.meta.url)), "utf8");

describe("Professional Director Phase A UI contract", () => {
  it("shows lyrics and Song Understanding before any professional treatment", () => {
    expect(source).toContain("2. Lyrics");
    expect(source).toContain("3. Understanding");
    expect(source).toContain("Verify the lyrics");
    expect(source).toContain("Paste official lyrics");
    expect(source).toContain("Align Official Lyrics");
    expect(source).toContain("Mark as instrumental");
    expect(source).toContain("Approve Lyrics");
    expect(source).toContain("Analyze Song Meaning");
    expect(source).toContain("Approve Song Understanding");
    expect(source).toContain("Uncertainties");
  });

  it("retires the old heuristic plan button from the guided workflow", () => {
    expect(source).not.toContain(">Create Video Plan<");
    expect(source).toContain("Professional Treatment is the next implementation phase");
    expect(source).toContain("Advanced Editor");
  });
});
