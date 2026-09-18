import { timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import type { AppConfig } from '@harness/config';
import {
  FoundationStatusSchema,
  ServiceHealthSchema,
  type FoundationRecord,
} from '@harness/contracts';
import {
  getFoundationRecord,
  openHarnessDatabase,
  saveFoundationRecord,
} from '@harness/persistence';

const FOUNDATION_RECORD_ID = 'increment-0';

function tokensMatch(expected: string, presented: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const presentedBytes = Buffer.from(presented);

  return (
    expectedBytes.length === presentedBytes.length &&
    timingSafeEqual(expectedBytes, presentedBytes)
  );
}

export function createService(config: AppConfig) {
  const service = Fastify({ logger: true });
  const store = openHarnessDatabase(config.databasePath);
  const foundationRecord: FoundationRecord = {
    id: FOUNDATION_RECORD_ID,
    value: 'Repository foundation ready',
    createdAt: new Date().toISOString(),
  };

  if (!getFoundationRecord(store.database, FOUNDATION_RECORD_ID)) {
    saveFoundationRecord(store.database, foundationRecord);
  }

  service.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    if (origin && !config.allowedOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'Origin is not allowed.' });
    }

    const presentedToken = request.headers['x-harness-session'];
    if (
      typeof presentedToken !== 'string' ||
      !tokensMatch(config.sessionToken, presentedToken)
    ) {
      return reply
        .code(401)
        .send({ error: 'A valid local session is required.' });
    }
  });

  service.get('/api/health', async () =>
    ServiceHealthSchema.parse({
      service: 'ready',
      database: 'ready',
      checkedAt: new Date().toISOString(),
    }),
  );

  service.get('/api/foundation', async () => {
    const record = getFoundationRecord(store.database, FOUNDATION_RECORD_ID);
    if (!record) {
      throw new Error(
        'Foundation record is missing after database initialization.',
      );
    }

    return FoundationStatusSchema.parse({
      record,
      migrationCount: store.migrationCount,
    });
  });

  service.addHook('onClose', async () => {
    store.close();
  });

  return service;
}
