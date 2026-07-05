import { describe, expect, it } from "vitest";
import { withGlobalFacts } from "../src/agents.js";

describe("withGlobalFacts", () => {
  it("injects global facts into a specialist system prompt", () => {
    const system = withGlobalFacts("És o especialista.", [
      "O Lauro prefere local-first.",
      "O projeto usa SQLite.",
    ]);

    expect(system).toContain("És o especialista.");
    expect(system).toContain("- O Lauro prefere local-first.");
    expect(system).toContain("- O projeto usa SQLite.");
  });

  it("does not add an empty facts section", () => {
    expect(withGlobalFacts("És o especialista.", [])).toBe("És o especialista.");
  });
});
