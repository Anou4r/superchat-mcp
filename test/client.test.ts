import assert from "node:assert/strict";
import test from "node:test";
import { SuperchatApiError, SuperchatClient } from "../src/client.js";

const apiKey = "test-secret-value";

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), init);
}

function client(
  fetch: typeof globalThis.fetch,
  options: { timeoutMs?: number; maxRetries?: number } = {},
): SuperchatClient {
  return new SuperchatClient({ apiKey, fetch, maxRetries: 0, ...options });
}

async function expectError(promise: Promise<unknown>, code: string): Promise<SuperchatApiError> {
  try {
    await promise;
    assert.fail("Expected the request to fail");
  } catch (error) {
    assert.ok(error instanceof SuperchatApiError);
    assert.equal(error.code, code);
    return error;
  }
}

test("encodes query values and authenticates on the fixed API origin", async () => {
  let calls = 0;
  const api = client(async (input, init) => {
    calls += 1;
    assert.equal(
      String(input),
      "https://api.superchat.com/v1.0/contacts?after=ct_1&limit=25&active=false&tag=a%26b&tag=x+y",
    );
    assert.equal(new Headers(init?.headers).get("X-API-KEY"), apiKey);
    assert.equal(new Headers(init?.headers).get("Accept"), "application/json");
    assert.equal(init?.redirect, "error");
    return json({ results: [] });
  });
  assert.deepEqual(
    await api.request({
      method: "GET",
      path: "/contacts",
      query: {
        after: "ct_1",
        limit: 25,
        active: false,
        tag: ["a&b", null, "x y"],
        missing: undefined,
      },
    }),
    { results: [] },
  );
  assert.equal(calls, 1);
});

test("rejects absolute, traversal, and embedded-query paths without fetching", async () => {
  const api = client(async () => assert.fail("fetch must not be called"));
  for (const path of [
    "https://elsewhere.example/contacts",
    "//elsewhere.example/contacts",
    "/../contacts",
    "/%2e%2e/contacts",
    "/contacts?after=x",
    "/contacts#x",
    "/contacts\\x",
    "/%2felsewhere",
    "/bad%xx",
  ]) {
    await expectError(api.request({ method: "GET", path }), "INVALID_REQUEST");
  }
});

test("serializes JSON writes and preserves the response", async () => {
  const api = client(async (_input, init) => {
    assert.equal(init?.method, "POST");
    assert.equal(new Headers(init?.headers).get("Content-Type"), "application/json");
    assert.equal(init?.body, '{"query":{"value":[]}}');
    return json({ id: "ct_1" }, { status: 201 });
  });
  assert.deepEqual(
    await api.request({ method: "POST", path: "/contacts/search", body: { query: { value: [] } } }),
    { id: "ct_1" },
  );
});

test("returns null for an empty response", async () => {
  const api = client(async () => new Response(null, { status: 204 }));
  assert.equal(await api.request({ method: "DELETE", path: "/contacts/ct_1" }), null);
});

test("preserves useful API errors while redacting the API key", async () => {
  const api = client(async () =>
    json(
      {
        errors: [{ code: "bad_key", title: "Unauthorized", detail: `Key ${apiKey} was rejected` }],
      },
      { status: 401 },
    ),
  );
  const error = await expectError(api.request({ method: "GET", path: "/me" }), "bad_key");
  assert.deepEqual(error.toJSON(), {
    code: "bad_key",
    message: "Unauthorized Key [REDACTED] was rejected",
    status: 401,
    retryable: false,
  });
  assert.ok(!JSON.stringify(error).includes(apiKey));
  assert.ok(!String(error.stack).includes(apiKey));
});

test("does not expose raw network errors or non-JSON upstream pages", async () => {
  const brokenNetwork = client(async () => {
    throw new Error(`Connection failed using ${apiKey}`);
  });
  const networkError = await expectError(
    brokenNetwork.request({ method: "GET", path: "/me" }),
    "NETWORK_ERROR",
  );
  assert.ok(!networkError.message.includes(apiKey));
  const html = client(async () => new Response(`<html>${apiKey}</html>`, { status: 502 }));
  const httpError = await expectError(html.request({ method: "GET", path: "/me" }), "HTTP_ERROR");
  assert.equal(httpError.message, "Superchat API request failed with HTTP 502.");
});

test("retries GET rate limits and transient server failures", async () => {
  const statuses = [429, 503, 200];
  let calls = 0;
  const api = client(
    async () => {
      const status = statuses[calls++];
      assert.ok(status);
      return json(status === 200 ? { id: "usr_1" } : { errors: [{ detail: "Try again" }] }, {
        status,
        headers: { "Retry-After": "0" },
      });
    },
    { maxRetries: 2 },
  );
  assert.deepEqual(await api.request({ method: "GET", path: "/me" }), { id: "usr_1" });
  assert.equal(calls, 3);
});

test("retries GET network failures only up to the configured bound", async () => {
  let calls = 0;
  const api = client(
    async () => {
      calls += 1;
      throw new Error("unavailable");
    },
    { maxRetries: 1 },
  );
  const error = await expectError(api.request({ method: "GET", path: "/me" }), "NETWORK_ERROR");
  assert.equal(calls, 2);
  assert.equal(error.retryable, true);
});

test("never retries writes, including POST contact search", async () => {
  for (const method of ["POST", "PATCH", "PUT", "DELETE"] as const) {
    let calls = 0;
    const api = client(
      async () => {
        calls += 1;
        return json(
          { errors: [{ title: "Unavailable" }] },
          { status: 503, headers: { "Retry-After": "0" } },
        );
      },
      { maxRetries: 2 },
    );
    const error = await expectError(
      api.request({ method, path: "/contacts/search" }),
      "HTTP_ERROR",
    );
    assert.equal(calls, 1);
    assert.equal(error.retryable, false);
  }
});

test("returns long retry-after values without retrying earlier than requested", async () => {
  let calls = 0;
  const api = client(
    async () => {
      calls += 1;
      return json({}, { status: 429, headers: { "Retry-After": "3600" } });
    },
    { maxRetries: 1 },
  );
  const error = await expectError(api.request({ method: "GET", path: "/me" }), "HTTP_ERROR");
  assert.equal(error.retryAfter, 3600);
  assert.equal(calls, 1);
});

test("times out while awaiting headers even if a fetch implementation ignores abort", async () => {
  const api = client(async () => new Promise<Response>(() => undefined), { timeoutMs: 20 });
  await expectError(api.request({ method: "GET", path: "/me" }), "TIMEOUT");
});

test("keeps the timeout active while consuming the response body", async () => {
  let cancelled = false;
  const api = client(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
      ),
    { timeoutMs: 20 },
  );
  await expectError(api.request({ method: "GET", path: "/me" }), "TIMEOUT");
  assert.equal(cancelled, true);
});

test("honors caller cancellation without leaking the cancellation reason", async () => {
  const controller = new AbortController();
  const api = client(async () => new Promise<Response>(() => undefined));
  const result = api.request({ method: "GET", path: "/me", signal: controller.signal });
  controller.abort(new Error(apiKey));
  const error = await expectError(result, "ABORTED");
  assert.ok(!JSON.stringify(error).includes(apiKey));
});

test("does not fetch for an already cancelled request", async () => {
  const api = client(async () => assert.fail("fetch must not be called"));
  await expectError(
    api.request({ method: "GET", path: "/me", signal: AbortSignal.abort(apiKey) }),
    "ABORTED",
  );
});

test("rejects redirects, invalid JSON, and oversized declared responses", async () => {
  await expectError(
    client(async () => new Response(null, { status: 302 })).request({ method: "GET", path: "/me" }),
    "UNEXPECTED_REDIRECT",
  );
  await expectError(
    client(async () => new Response(`not-json ${apiKey}`)).request({ method: "GET", path: "/me" }),
    "INVALID_RESPONSE",
  );
  await expectError(
    client(
      async () => new Response("{}", { headers: { "Content-Length": String(6 * 1024 * 1024) } }),
    ).request({ method: "GET", path: "/me" }),
    "RESPONSE_TOO_LARGE",
  );
});

test("enforces the response limit even without a content-length header", async () => {
  const api = client(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
            controller.close();
          },
        }),
      ),
  );
  await expectError(api.request({ method: "GET", path: "/me" }), "RESPONSE_TOO_LARGE");
});

test("validates configuration and JSON request bodies without exposing secrets", async () => {
  for (const options of [
    { apiKey: "" },
    { apiKey, baseUrl: "http://example.com" },
    { apiKey, baseUrl: `https://${apiKey}@example.com` },
    { apiKey, timeoutMs: 0 },
    { apiKey, maxRetries: 6 },
  ]) {
    assert.throws(
      () => new SuperchatClient(options),
      (error) =>
        error instanceof SuperchatApiError &&
        error.code === "INVALID_CONFIG" &&
        !error.message.includes(apiKey),
    );
  }
  const api = client(async () => assert.fail("fetch must not be called"));
  await expectError(api.request({ method: "GET", path: "/me", body: {} }), "INVALID_REQUEST");
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  await expectError(
    api.request({ method: "POST", path: "/contacts", body: circular }),
    "INVALID_REQUEST",
  );
});
