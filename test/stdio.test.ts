import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const cwd = fileURLToPath(new URL("..", import.meta.url));
const cli = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], {
  cwd,
});

for (const mode of ["legacy", "auto"] as const) {
  test(
    `compiled CLI works over stdio (${mode}) without credentials and closes cleanly`,
    { timeout: 15_000 },
    async (t) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [cli],
        cwd,
        env: {
          SUPERCHAT_API_KEY: "",
          SUPERCHAT_ENABLE_WRITES: "false",
          SUPERCHAT_ENABLE_DELETES: "false",
          SUPERCHAT_ENABLE_ENTERPRISE_TOOLS: "false",
        },
        stderr: "pipe",
      });
      let stderr = "";
      transport.stderr?.on("data", (data) => {
        stderr += String(data);
      });
      const client = new Client(
        { name: "stdio-smoke", version: "1" },
        { versionNegotiation: { mode } },
      );
      t.after(async () => {
        await client.close();
      });
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.equal(tools.length, 26);
      const result = await client.callTool({ name: "superchat_get_me", arguments: {} });
      assert.equal(result.isError, true);
      assert.ok(JSON.stringify(result).includes("MISSING_API_KEY"));
      assert.ok(stderr.includes("SUPERCHAT_API_KEY"));
      await client.close();
    },
  );
}

test("CLI help and version work without secrets; unknown arguments fail", () => {
  const help = execFileSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.ok(help.includes("SUPERCHAT_ENABLE_WRITES"));
  assert.equal(
    execFileSync(process.execPath, [cli, "--version"], { encoding: "utf8" }).trim(),
    "0.1.0",
  );
  assert.throws(() => execFileSync(process.execPath, [cli, "--http"], { stdio: "pipe" }));
});
