import { describe, expect, it, vi } from "vitest";
import { runIngestCli } from "../src/ingest-cli.js";

describe("ingest CLI", () => {
  it("posts the path and label to the local ingest endpoint", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ result: "Indexados 2 chunks." }),
    })) as unknown as typeof fetch;
    const log = vi.fn();

    const code = await runIngestCli(["C:\\repos\\sample", "sample-repo"], {
      serverUrl: "http://localhost:8791/",
      apiToken: "secret",
      fetchImpl,
      log,
    });

    expect(code).toBe(0);
    expect(fetchImpl).toHaveBeenCalledWith("http://localhost:8791/ingest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-jarvis-token": "secret",
      },
      body: JSON.stringify({ path: "C:\\repos\\sample", label: "sample-repo" }),
    });
    expect(log).toHaveBeenCalledWith("Indexados 2 chunks.");
  });

  it("prints usage and does not call the endpoint without both args", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const error = vi.fn();

    const code = await runIngestCli(["C:\\repos\\sample"], { fetchImpl, error });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith("Uso: npm run ingest -- <path> <label>");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns failure when the endpoint rejects the request", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => JSON.stringify({ error: "Campo 'path' em falta." }),
    })) as unknown as typeof fetch;
    const error = vi.fn();

    const code = await runIngestCli(["C:\\repos\\sample", "sample-repo"], {
      fetchImpl,
      error,
    });

    expect(code).toBe(1);
    expect(error).toHaveBeenCalledWith("Campo 'path' em falta.");
  });
});
