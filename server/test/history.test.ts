import { describe, expect, it } from "vitest";
import { normaliseHistory } from "../src/history.js";

describe("normaliseHistory", () => {
  it("drops leading assistant and non-chat turns", () => {
    expect(
      normaliseHistory([
        { role: "assistant", content: "Saudação local" },
        { role: "tool", content: "resultado", tool_call_id: "call-1" },
        { role: "user", content: "Pergunta" },
        { role: "assistant", content: "Resposta" },
      ]),
    ).toEqual([
      { role: "user", content: "Pergunta" },
      { role: "assistant", content: "Resposta" },
    ]);
  });

  it("returns an empty history when there is no user turn", () => {
    expect(normaliseHistory([{ role: "assistant", content: "Olá" }])).toEqual([]);
  });
});
