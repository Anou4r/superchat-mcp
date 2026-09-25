#!/usr/bin/env node
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { createServer, VERSION } from "./server.js";

const args = process.argv.slice(2);
if (args.length === 1 && (args[0] === "--help" || args[0] === "-h")) {
  process.stdout.write(
    `superchat-mcp ${VERSION} — unofficial Superchat MCP server\n\nUsage: superchat-mcp [--help | --version]\nTransport: stdio (launch from an MCP client, such as Claude Desktop).\n\nEnvironment:\n  SUPERCHAT_API_KEY          Your Superchat API key\n  SUPERCHAT_ENABLE_WRITES    true or false; default false\n  SUPERCHAT_ENABLE_DELETES   true or false; requires writes; default false\n  SUPERCHAT_ENABLE_ENTERPRISE_TOOLS  true or false; default false\n  SUPERCHAT_TIMEOUT_MS       Total request deadline; default 30000\n  SUPERCHAT_MAX_RETRIES      Maximum GET retries; default 2\n\nWithout an API key, tool discovery works but API operations fail.\n`,
  );
} else if (args.length === 1 && args[0] === "--version") {
  process.stdout.write(`${VERSION}\n`);
} else if (args.length > 0) {
  console.error("Unsupported argument. Use --help for usage.");
  process.exitCode = 1;
} else {
  try {
    const config = loadConfig();
    // Validate before opening stdio so configuration errors cannot corrupt the protocol.
    const initial = createServer(config);
    await initial.close();
    const handle = serveStdio(() => createServer(config));
    if (!config.apiKey)
      console.error(
        "SUPERCHAT_API_KEY is not set. Tool discovery is available; API calls are disabled.",
      );
    const shutdown = () => {
      void handle.close().catch(() => {
        process.exitCode = 1;
      });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch {
    console.error(
      "Superchat MCP could not start. Check the API key and environment settings listed in --help.",
    );
    process.exitCode = 1;
  }
}
