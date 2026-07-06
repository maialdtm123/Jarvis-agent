import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgent, toAnthropicMessages } from "../src/anthropic.js";
import type { Tool, ToolContext } from "../src/types.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe("runAgent stream events", () => {
  it("emits tool events and final orchestrator text chunks", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                content: "",
                tool_calls: [
                  {
                    id: "call-1",
                    function: { name: "calculator", arguments: '{"expression":"2+2"}' },
                  },
                ],
              },
            },
          ],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          choices: [
            {
              finish_reason: "stop",
              message: { content: "Tudo certo" },
            },
          ],
        }),
      } as Response);

    const events: string[] = [];
    const calculator: Tool = {
      name: "calculator",
      description: "fake calculator",
      input_schema: {},
      run: () => "4",
    };
    const ctx = {
      sessionId: "stream",
      events: {
        toolStart: (event) => events.push(`start:${event.agent}:${event.tool}`),
        toolResult: (event) => events.push(`result:${event.agent}:${event.tool}:${event.output}`),
        text: (event) => events.push(`text:${event.agent}:${event.text}`),
      },
    } as ToolContext;

    const reply = await runAgent({
      label: "orchestrator",
      system: "És o Jarvis.",
      model: "test-model",
      tools: [calculator],
      messages: [{ role: "user", content: "calcula" }],
      ctx,
    });

    expect(reply).toBe("Tudo certo");
    expect(events).toEqual([
      "start:orchestrator:calculator",
      "result:orchestrator:calculator:4",
      "text:orchestrator:Tudo ",
      "text:orchestrator:certo",
    ]);
  });
});
