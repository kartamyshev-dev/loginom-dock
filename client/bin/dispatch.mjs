#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

process.umask(0o077);
const [command, agent, revision, ...extra] = process.argv.slice(2);
const root = process.env.LOGINOM_DOCK_HOME || join(homedir(), '.loginom-dock');
const entry = { mcp: 'loginom-dock.mjs', hook: 'hook.mjs', flush: 'hook.mjs' }[command];
if (!entry || !isAbsolute(root) || !['codex', 'hermes'].includes(agent) || !revision) {
  process.stderr.write('Loginom Dock: неверные параметры запуска.\n'); process.exit(2);
}
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL(entry, import.meta.url)),
  '--config', join(root, 'config.json'), '--state-dir', root, '--agent', agent, '--adapter-revision', revision,
  ...(command === 'flush' ? ['--flush'] : []), ...extra], { stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { process.stderr.write('Loginom Dock: среда запуска недоступна.\n'); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
