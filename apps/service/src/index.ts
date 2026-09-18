import { loadAppConfig } from '@harness/config';
import { createService } from './app.js';

const config = loadAppConfig();
const service = createService(config);

const shutdown = async () => {
  await service.close();
  process.exit(0);
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);

try {
  await service.listen({ host: config.host, port: config.port });
} catch (error) {
  service.log.error(error);
  process.exit(1);
}
