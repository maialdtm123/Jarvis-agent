import { describe, expect, it } from "vitest";
import { toAnthropicMessages } from "../src/anthropic.js";

describe("toAnthropicMessages", () => {
  it("extracts system text and translates tool calls/results", () => {
    const result = toAnthropicMessages([
      { role: "system", content: "Regra um" },
      { role: "system", content: "Regra dois" },
      { role: "user", content: "Calcula" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "calculator", arguments: '{"expression":"2+2"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "call-1", content: "4" },
    ]);

    expect(result.system).toBe("Regra um\nRegra dois");
    expect(result.msgs).toEqual([
      { role: "user", content: "Calcula" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call-1",
            name: "calculator",
            input: { expression: "2+2" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call-1", content: "4" }],
      },
    ]);
  });

  it("falls back to empty tool input for malformed JSON", () => {
    const { msgs } = toAnthropicMessages([
      {
        role: "assistant",
        content: "Vou tentar.",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "calculator", arguments: "not-json" },
          },
        ],
      },
    ]);

    expect(msgs[0].content[1].input).toEqual({});
  });
});
