import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, chmod, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../lib/config.mjs';

const actor = { agent: 'codex', adapterRevision: 'test-1' };
const valid = { endpoint: 'https://dock.example/mcp', api_key: 'test-only', account: 'loginom-dock', user: 'loginom-dock' };

test('requires Dock config even when personal OpenViking config is set', async () => {
  process.env.OPENVIKING_CLI_CONFIG_FILE = '/personal/ovcli.conf';
  await assert.rejects(loadConfig(actor), /explicit Dock config/);
  delete process.env.OPENVIKING_CLI_CONFIG_FILE;
});

test('restricts credential files, endpoint and identity before connecting', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'dock-config-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'client.json');
  const options = { ...actor, configPath: path, stateDir: join(directory, 'state') };
  await writeFile(path, JSON.stringify(valid), { mode: 0o600 });
  assert.equal((await loadConfig(options)).apiKey, 'test-only');
  await chmod(path, 0o644);
  await assert.rejects(loadConfig(options), /0600/);
  await chmod(path, 0o600);
  await symlink(path, join(directory, 'link.json'));
  await assert.rejects(loadConfig({ ...options, configPath: join(directory, 'link.json') }), /regular file/);
  for (const endpoint of ['http://dock.example/mcp', 'https://user:secret@dock.example/mcp', 'https://dock.example/mcp?key=x']) {
    await writeFile(path, JSON.stringify({ ...valid, endpoint }));
    await assert.rejects(loadConfig(options), /HTTPS/);
  }
  await writeFile(path, JSON.stringify({ ...valid, user: 'dock-admin' }));
  await assert.rejects(loadConfig(options), /ordinary loginom-dock/);
  await writeFile(path, JSON.stringify({ ...valid, loginom_url: 'https://loginom.example/app?testable=true' }));
  assert.equal((await loadConfig(options)).loginomUrl, 'https://loginom.example/app?testable=true');
  await writeFile(path, JSON.stringify({ ...valid, loginom_url: 'https://loginom.example/app?token=private' }));
  await assert.rejects(loadConfig(options), /contain credentials/);
});
