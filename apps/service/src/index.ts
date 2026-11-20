import { loadAppConfig } from '@harness/config';
import { createService } from './app.js';
import { removeConnection, writeConnection } from './connection.js';

const config = loadAppConfig();
const service = createService(config);

const shutdown = async () => {
  removeConnection(config.dataDirectory);
  await service.close();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await service.listen({ host: config.host, port: config.port });
  // For the MCP server (npm run mcp), which agent tools start themselves.
  writeConnection(config.dataDirectory, {
    url: `http://${config.host}:${config.port}`,
    token: config.sessionToken,
  });
} catch (error) {
  // Say the common failure in words: under a dev watcher a JSON log line
  // is easy to miss, and the client then shows only "not answering".
  if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') {
    console.error(
      `\nPort ${config.port} is already in use by another program, so the harness service cannot start.\n` +
        `Stop that program, or pick another port: add HARNESS_PORT=${config.port + 1} to .env.local and restart.\n`,
    );
  } else {
    service.log.error(error);
  }
  process.exit(1);
}
