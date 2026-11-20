import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createHarnessServer } from './tools.js';

// The Harness MCP server. An agent tool starts it and talks to it over
// stdin/stdout; it passes calls on to the Harness app on this computer.
// stdout belongs to the protocol, so anything said goes to stderr.

const server = createHarnessServer({
  cwd: process.cwd(),
  clientName: process.env.HARNESS_CLIENT_NAME || undefined,
});

await server.connect(new StdioServerTransport());
process.stderr.write('Harness MCP server ready.\n');
