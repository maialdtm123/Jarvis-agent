import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";

interface IngestCliOptions {
  serverUrl?: string;
  apiToken?: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  error?: (message: string) => void;
}

function usage(): string {
  return "Uso: npm run ingest -- <path> <label>";
}

function endpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/ingest`;
}

export async function runIngestCli(
  args = process.argv.slice(2),
  options: IngestCliOptions = {},
): Promise<number> {
  const log = options.log ?? console.log;
  const error = options.error ?? console.error;
  const [path, label] = args;

  if (!path || !label) {
    error(usage());
    return 1;
  }

  const serverUrl = options.serverUrl ?? process.env.JARVIS_SERVER_URL ?? `http://localhost:${config.port}`;
  const apiToken = options.apiToken ?? config.apiToken;
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (apiToken) headers["x-jarvis-token"] = apiToken;

  try {
    const response = await fetchImpl(endpoint(serverUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ path, label }),
    });
    const text = await response.text();
    let body: any = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text };
    }

    if (!response.ok) {
      error(String(body.error ?? `Falha HTTP ${response.status}`));
      return 1;
    }

    log(String(body.result ?? "Ingestão concluída."));
    return 0;
  } catch (e) {
    error(`Falha ao chamar ${endpoint(serverUrl)}: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runIngestCli();
}
