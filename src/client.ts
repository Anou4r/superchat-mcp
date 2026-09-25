export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type QueryScalar = string | number | boolean | null;
export type QueryValue = QueryScalar | readonly QueryScalar[];

export interface SuperchatRequest {
  method: HttpMethod;
  path: string;
  query?: Record<string, QueryValue | undefined>;
  body?: unknown;
  signal?: AbortSignal;
}

export interface SuperchatClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetch?: typeof globalThis.fetch;
}

interface ApiErrorOptions {
  code: string;
  status?: number;
  retryAfter?: number;
  retryable?: boolean;
}

export class SuperchatApiError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  readonly retryAfter: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, options: ApiErrorOptions) {
    super(message);
    this.name = "SuperchatApiError";
    this.code = options.code;
    this.status = options.status;
    this.retryAfter = options.retryAfter;
    this.retryable = options.retryable ?? false;
  }

  toJSON(): {
    code: string;
    message: string;
    status?: number;
    retryAfter?: number;
    retryable: boolean;
  } {
    return {
      code: this.code,
      message: this.message,
      ...(this.status === undefined ? {} : { status: this.status }),
      ...(this.retryAfter === undefined ? {} : { retryAfter: this.retryAfter }),
      retryable: this.retryable,
    };
  }
}

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_RETRY_DELAY_MS = 30_000;
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    if (signal.aborted) {
      reject(signal.reason);
      void promise.catch(() => undefined);
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function retryAfterSeconds(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.max(0, seconds) : undefined;
}

async function readResponse(response: Response, signal: AbortSignal): Promise<string> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (declaredSize > MAX_RESPONSE_BYTES) {
    void response.body?.cancel().catch(() => undefined);
    throw new SuperchatApiError("Superchat returned a response larger than 5 MiB.", {
      code: "RESPONSE_TOO_LARGE",
    });
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await abortable(reader.read(), signal);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) {
        throw new SuperchatApiError("Superchat returned a response larger than 5 MiB.", {
          code: "RESPONSE_TOO_LARGE",
        });
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export class SuperchatClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;
  readonly #fetch: typeof globalThis.fetch;

  constructor(options: SuperchatClientOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey || /[^\x20-\x7e]/.test(apiKey)) {
      throw new SuperchatApiError("Provide a valid Superchat API key.", { code: "INVALID_CONFIG" });
    }
    let baseUrl: URL;
    try {
      baseUrl = new URL(options.baseUrl ?? "https://api.superchat.com/v1.0");
    } catch {
      throw new SuperchatApiError("The Superchat base URL is invalid.", { code: "INVALID_CONFIG" });
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(baseUrl.hostname);
    if (
      (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && loopback)) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash
    ) {
      throw new SuperchatApiError(
        "The Superchat base URL must use HTTPS without credentials, query, or fragment.",
        {
          code: "INVALID_CONFIG",
        },
      );
    }
    const timeoutMs = options.timeoutMs ?? 30_000;
    const maxRetries = options.maxRetries ?? 2;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000) {
      throw new SuperchatApiError(
        "The request timeout must be between 1 and 300000 milliseconds.",
        {
          code: "INVALID_CONFIG",
        },
      );
    }
    if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 5) {
      throw new SuperchatApiError("The maximum retry count must be between 0 and 5.", {
        code: "INVALID_CONFIG",
      });
    }
    this.#apiKey = apiKey;
    this.#baseUrl = baseUrl.href.replace(/\/+$/, "");
    this.#timeoutMs = timeoutMs;
    this.#maxRetries = maxRetries;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  #redact(value: string): string {
    const variants = [
      this.#apiKey,
      encodeURIComponent(this.#apiKey),
      JSON.stringify(this.#apiKey).slice(1, -1),
    ];
    let safe = value;
    for (const secret of variants) safe = safe.split(secret).join("[REDACTED]");
    return safe.slice(0, 1000);
  }

  #requestUrl(path: string, query: SuperchatRequest["query"]): URL {
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      throw new SuperchatApiError("Use a valid relative Superchat API path.", {
        code: "INVALID_REQUEST",
      });
    }
    if (
      !path.startsWith("/") ||
      path.includes("//") ||
      /[\\?#\s]/.test(path) ||
      /[\\?#\x00-\x20]/.test(decoded) ||
      /%2f/i.test(path) ||
      decoded.split("/").some((part) => part === "." || part === "..")
    ) {
      throw new SuperchatApiError(
        "Use a relative Superchat API path without traversal, query, or fragment.",
        {
          code: "INVALID_REQUEST",
        },
      );
    }
    const url = new URL(this.#baseUrl + path);
    for (const [name, value] of Object.entries(query ?? {})) {
      const values = Array.isArray(value) ? value : [value];
      for (const item of values) {
        if (item !== null && item !== undefined) url.searchParams.append(name, String(item));
      }
    }
    return url;
  }

  #httpError(response: Response, body: string, canRetry: boolean): SuperchatApiError {
    let details = "";
    let upstreamCode: string | undefined;
    try {
      const parsed: unknown = JSON.parse(body);
      if (isRecord(parsed)) {
        const errors = Array.isArray(parsed.errors) ? parsed.errors : [parsed];
        details = errors
          .slice(0, 3)
          .flatMap((error: unknown) => {
            if (!isRecord(error)) return [];
            if (typeof error.code === "string" && upstreamCode === undefined)
              upstreamCode = error.code;
            return [error.title, error.detail, error.message].filter(
              (part): part is string => typeof part === "string",
            );
          })
          .join(" ");
      }
    } catch {
      // Unstructured upstream bodies may contain proxy pages or credentials.
    }
    const retryAfter = retryAfterSeconds(response.headers.get("retry-after"));
    return new SuperchatApiError(
      this.#redact(details || `Superchat API request failed with HTTP ${response.status}.`),
      {
        code: this.#redact(upstreamCode || "HTTP_ERROR"),
        status: response.status,
        ...(retryAfter === undefined ? {} : { retryAfter }),
        retryable: canRetry && RETRYABLE_STATUSES.has(response.status),
      },
    );
  }

  async request(request: SuperchatRequest): Promise<unknown> {
    const url = this.#requestUrl(request.path, request.query);
    const canRetry = request.method === "GET";
    if (request.body !== undefined && canRetry) {
      throw new SuperchatApiError("GET requests cannot contain a JSON body.", {
        code: "INVALID_REQUEST",
      });
    }
    let body: string | undefined;
    try {
      if (request.body !== undefined) body = JSON.stringify(request.body);
    } catch {
      throw new SuperchatApiError("The request body must be JSON serializable.", {
        code: "INVALID_REQUEST",
      });
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#timeoutMs);
    const signal = request.signal
      ? AbortSignal.any([controller.signal, request.signal])
      : controller.signal;
    try {
      for (let attempt = 0; ; attempt += 1) {
        signal.throwIfAborted();
        try {
          const response = await abortable(
            this.#fetch(url, {
              method: request.method,
              headers: {
                "X-API-KEY": this.#apiKey,
                Accept: "application/json",
                ...(body === undefined ? {} : { "Content-Type": "application/json" }),
              },
              ...(body === undefined ? {} : { body }),
              redirect: "error",
              signal,
            }),
            signal,
          );
          if (response.status >= 300 && response.status < 400) {
            void response.body?.cancel().catch(() => undefined);
            throw new SuperchatApiError("Superchat returned an unexpected redirect.", {
              code: "UNEXPECTED_REDIRECT",
              status: response.status,
            });
          }
          const responseBody = await readResponse(response, signal);
          if (!response.ok) throw this.#httpError(response, responseBody, canRetry);
          if (!responseBody.trim()) return null;
          try {
            return JSON.parse(responseBody) as unknown;
          } catch {
            throw new SuperchatApiError("Superchat returned invalid JSON.", {
              code: "INVALID_RESPONSE",
              status: response.status,
            });
          }
        } catch (error) {
          if (signal.aborted) throw error;
          const safeError =
            error instanceof SuperchatApiError
              ? error
              : new SuperchatApiError(
                  canRetry
                    ? "Could not reach the Superchat API."
                    : "The Superchat request failed before a response was received. Its outcome is unknown; do not automatically retry.",
                  { code: "NETWORK_ERROR", retryable: canRetry },
                );
          if (!canRetry || !safeError.retryable || attempt >= this.#maxRetries) throw safeError;
          const retryDelay =
            safeError.retryAfter === undefined ? 250 * 2 ** attempt : safeError.retryAfter * 1000;
          if (retryDelay > MAX_RETRY_DELAY_MS) throw safeError;
          await delay(retryDelay, signal);
        }
      }
    } catch (error) {
      if (request.signal?.aborted) {
        throw new SuperchatApiError("The Superchat request was cancelled.", { code: "ABORTED" });
      }
      if (controller.signal.aborted) {
        throw new SuperchatApiError(
          canRetry
            ? "The Superchat request timed out."
            : "The Superchat request timed out. Its outcome is unknown; do not automatically retry.",
          { code: "TIMEOUT" },
        );
      }
      if (error instanceof SuperchatApiError) throw error;
      throw new SuperchatApiError("The Superchat request failed.", { code: "REQUEST_FAILED" });
    } finally {
      clearTimeout(timeout);
    }
  }
}
