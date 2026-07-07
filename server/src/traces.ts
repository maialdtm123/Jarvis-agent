import { randomUUID } from "node:crypto";

const MAX_TRACES = 100;
const MAX_EVENTS_PER_TRACE = 300;

export type TraceStatus = "running" | "ok" | "error";

export interface TraceEvent {
  at: string;
  type: "start" | "token" | "tool_start" | "tool_result" | "done" | "error";
  agent?: string;
  tool?: string;
  text?: string;
  output?: string;
  error?: string;
}

export interface TraceRun {
  id: string;
  sessionId: string;
  message: string;
  stream: boolean;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: TraceStatus;
  reply?: string;
  error?: string;
  events: TraceEvent[];
}

interface StartTraceInput {
  sessionId: string;
  message: string;
  stream: boolean;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

export class TraceStore {
  private readonly traces: TraceRun[] = [];

  start(input: StartTraceInput): TraceRun {
    const trace: TraceRun = {
      id: randomUUID(),
      sessionId: input.sessionId,
      message: truncate(input.message, 500),
      stream: input.stream,
      startedAt: new Date().toISOString(),
      status: "running",
      events: [],
    };
    this.traces.push(trace);
    if (this.traces.length > MAX_TRACES) this.traces.splice(0, this.traces.length - MAX_TRACES);
    this.add(trace.id, { type: "start" });
    return trace;
  }

  add(traceId: string, event: Omit<TraceEvent, "at">): void {
    const trace = this.traces.find((item) => item.id === traceId);
    if (!trace || trace.events.length >= MAX_EVENTS_PER_TRACE) return;
    trace.events.push({
      ...event,
      at: new Date().toISOString(),
      text: event.text ? truncate(event.text, 300) : undefined,
      output: event.output ? truncate(event.output, 1000) : undefined,
      error: event.error ? truncate(event.error, 1000) : undefined,
    });
  }

  finish(traceId: string, reply: string): void {
    const trace = this.traces.find((item) => item.id === traceId);
    if (!trace) return;
    trace.status = "ok";
    trace.reply = truncate(reply, 1000);
    trace.endedAt = new Date().toISOString();
    trace.durationMs = Date.parse(trace.endedAt) - Date.parse(trace.startedAt);
    this.add(traceId, { type: "done" });
  }

  fail(traceId: string, error: string): void {
    const trace = this.traces.find((item) => item.id === traceId);
    if (!trace) return;
    trace.status = "error";
    trace.error = truncate(error, 1000);
    trace.endedAt = new Date().toISOString();
    trace.durationMs = Date.parse(trace.endedAt) - Date.parse(trace.startedAt);
    this.add(traceId, { type: "error", error });
  }

  list(limit = 50): TraceRun[] {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_TRACES) : 50;
    return this.traces.slice(-safeLimit).reverse();
  }
}
