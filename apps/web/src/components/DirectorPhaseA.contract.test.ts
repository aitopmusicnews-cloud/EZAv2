import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "apps/web/src/components/DirectorWorkspace.tsx"), "utf8");

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

  it("uses the professional treatment production flow instead of the old heuristic planner", () => {
    expect(source).not.toContain(">Create Video Plan<");
    expect(source).toContain("Style Picker");
    expect(source).toContain("Talk to Director");
    expect(source).toContain("Build Treatment");
    expect(source).toContain("Send Edit & Revise");
    expect(source).toContain("Generate Storyboard Images");
    expect(source).toContain("Generate Agnes Video Takes");
    expect(source).toContain("Render Final Music Video");
    expect(source).toContain("Advanced Editor");
  });
});
