import { describe, expect, it } from "vitest";
import { calculator } from "../src/tools.js";
import type { ToolContext } from "../src/types.js";

const unusedContext = {} as ToolContext;

describe("calculator", () => {
  it("evaluates arithmetic with precedence and decimal commas", async () => {
    expect(await calculator.run({ expression: "2 * (3 + 4)" }, unusedContext)).toBe("14");
    expect(await calculator.run({ expression: "1,5 + 2" }, unusedContext)).toBe("3.5");
  });

  it("rejects identifiers and invalid results", async () => {
    expect(await calculator.run({ expression: "process.exit()" }, unusedContext)).toContain(
      "inválida",
    );
    expect(await calculator.run({ expression: "1 / 0" }, unusedContext)).toBe(
      "Resultado inválido.",
    );
  });
});
