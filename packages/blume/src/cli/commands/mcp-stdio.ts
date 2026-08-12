import { readFile } from "node:fs/promises";

import { defineCommand } from "citty";

import type { McpData } from "../../ai/mcp/data.ts";
import { serveMcpStdio } from "../../ai/mcp/stdio.ts";

export const mcpStdioCommand = defineCommand({
  args: {
    data: {
      description: "Path to a serialized MCP data snapshot (JSON).",
      required: true,
      type: "string",
    },
  },
  meta: {
    description:
      "MCP-сервер снимка данных через stdio (внутренняя команда для `bedocs eval`).",
    name: "mcp-stdio",
  },
  async run({ args }) {
    // stdout belongs to the JSON-RPC transport from here on; every diagnostic
    // must go to stderr or the MCP client chokes on the stray line.
    let data: McpData;
    try {
      data = JSON.parse(await readFile(args.data, "utf-8")) as McpData;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `bedocs mcp-stdio: cannot load the snapshot at ${args.data}: ${detail}\n`
      );
      process.exit(1);
    }
    await serveMcpStdio(data);
  },
});
