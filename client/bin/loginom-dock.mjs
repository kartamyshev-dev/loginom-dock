#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../lib/config.mjs';
import { createSession } from '../lib/session.mjs';
import { createBridge } from '../lib/bridge.mjs';

process.umask(0o077);
let bridge;
try {
  const { values } = parseArgs({ options: {
    config: { type: 'string' }, 'state-dir': { type: 'string' },
    agent: { type: 'string' }, 'adapter-revision': { type: 'string' },
    headless: { type: 'boolean', default: false },
  } });
  const config = await loadConfig({
    configPath: values.config || process.env.LOGINOM_DOCK_CONFIG,
    stateDir: values['state-dir'], agent: values.agent, adapterRevision: values['adapter-revision'],
  });
  const session = await createSession(config, { headless: values.headless });
  bridge = await createBridge(config, session);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, async () => { await bridge.close(); process.exit(0); });
  }
  process.stdin.once('end', () => { void bridge.close(); });
  await bridge.server.connect(new StdioServerTransport());
} catch {
  // Config parsing and upstream failures may embed secrets. Startup logs are fixed.
  process.stderr.write('Loginom Dock could not start. Check its explicit config, pinned runtime, browser installation and server availability.\n');
  await bridge?.close();
  process.exitCode = 1;
}
