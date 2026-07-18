// @ts-check

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function read(path) {
  return readFile(join(ROOT, path), 'utf8');
}

test('current design and operational docs name the complete Node CLI as authoritative', async () => {
  const design = await read('docs/specs/jeff-design.md');
  const schema = await read('skills/cook/reference/jeff-state-schema.md');
  const initiative = await read('docs/specs/pi-shell-initiative.md');

  assert.match(design, /src\/cli\/cook\.js` is the sole operational CLI/);
  assert.match(design, /`lite`, `on`/);
  assert.match(design, /`indiff`, `deinit`/);
  assert.match(schema, /sole operational entry is `src\/cli\/cook\.js`/);
  assert.doesNotMatch(`${design}\n${schema}`, /Bash validator remains|supplies compatibility|verbs that have not moved/);
  assert.match(initiative, /Native\n  host smoke results are release evidence, recorded per host/);
  assert.doesNotMatch(initiative, /completed .*host smoke tests/);
});
