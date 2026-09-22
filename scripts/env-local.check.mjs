import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { envLocalPath, loadEnvLocal } from './env-local.mjs';

test('env-local exports both helpers and loads without overriding', () => {
  const root = mkdtempSync(join(tmpdir(), 'env-local-'));
  writeFileSync(
    join(root, '.env.local'),
    '# c\nA_TEST_ONE=1\nexport A_TEST_TWO="two"\nPATH=nope\n',
  );
  assert.equal(envLocalPath(root), join(root, '.env.local'));
  const loaded = loadEnvLocal(root);
  assert.deepEqual(loaded, ['A_TEST_ONE', 'A_TEST_TWO']);
  assert.equal(process.env.A_TEST_TWO, 'two');
  assert.notEqual(process.env.PATH, 'nope');
});
