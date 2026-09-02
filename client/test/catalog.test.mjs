import test from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog, combineCatalogs } from '../lib/catalog.mjs';

const tool = (name) => ({ name, inputSchema: { type: 'object', properties: {} } });

test('reads all tool pages and detects a non-advancing cursor', async () => {
  const pages = [{ tools: [tool('read')], nextCursor: 'next' }, { tools: [tool('find')] }];
  const calls = [];
  assert.deepEqual((await readCatalog({ listTools: async (args) => { calls.push(args); return pages.shift(); } })).map(t => t.name), ['read', 'find']);
  assert.deepEqual(calls, [{}, { cursor: 'next' }]);
  await assert.rejects(readCatalog({ listTools: async () => ({ tools: [], nextCursor: 'same' }) }), /Repeated/);
});

test('fails explicitly on collisions including different catalog owners', () => {
  assert.throws(() => combineCatalogs({ remote: [tool('read')], browser: [tool('read')] }), /collision: read/);
  assert.throws(() => combineCatalogs({ remote: [tool('read'), tool('read')] }), /collision/);
});

test('preserves tool schemas and isolates the pinned session from later catalog changes', () => {
  const remote = [tool('read')];
  const result = combineCatalogs({ remote, browser: [tool('browser_navigate')] });
  remote[0].inputSchema.properties.changed = { type: 'string' };
  assert.deepEqual(result.tools[0], tool('read'));
  assert.equal(result.routes.get('read'), 'remote');
  assert.equal(result.routes.get('browser_navigate'), 'browser');
  assert.equal(result.sha256.length, 64);
});
