import type { Turn } from "./types.js";

/** Drop non-chat and leading assistant turns so provider history starts with a user. */
export function normaliseHistory(
  turns: Turn[],
): { role: "user" | "assistant"; content: string }[] {
  const flat = turns
    .filter((turn) => turn.role === "user" || turn.role === "assistant")
    .map((turn) => ({
      role: turn.role as "user" | "assistant",
      content: typeof turn.content === "string" ? turn.content : "",
    }));
  const firstUser = flat.findIndex((turn) => turn.role === "user");
  return firstUser === -1 ? [] : flat.slice(firstUser);
}
