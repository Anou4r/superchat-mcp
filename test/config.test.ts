import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";

test("defaults to read-only and allows discovery without credentials", () => {
  assert.deepEqual(loadConfig({}), {
    apiKey: "",
    enableWrites: false,
    enableDeletes: false,
    enableEnterpriseTools: false,
    timeoutMs: 30000,
    maxRetries: 2,
  });
});

test("rejects ambiguous flags and unsafe numeric settings", () => {
  for (const env of [
    { SUPERCHAT_ENABLE_WRITES: "1" },
    { SUPERCHAT_ENABLE_DELETES: "true" },
    { SUPERCHAT_TIMEOUT_MS: "0" },
    { SUPERCHAT_TIMEOUT_MS: "NaN" },
    { SUPERCHAT_MAX_RETRIES: "6" },
    { SUPERCHAT_MAX_RETRIES: "" },
  ])
    assert.throws(() => loadConfig(env));
  assert.equal(
    loadConfig({ SUPERCHAT_ENABLE_WRITES: "true", SUPERCHAT_ENABLE_DELETES: "true" }).enableDeletes,
    true,
  );
});
