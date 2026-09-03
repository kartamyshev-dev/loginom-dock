import { readFile, lstat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeConfigPath } from '../../examples/memory-plugin-shared/lib/mcp-proxy-config.mjs';
import { privatePath } from './platform.mjs';

export async function loadConfig({ configPath, stateDir, agent, adapterRevision }) {
  if (!configPath) throw new Error('An explicit Dock config path is required');
  if (!['codex', 'hermes'].includes(agent) || !adapterRevision?.trim()) {
    throw new Error('Explicit agent and adapter revision are required');
  }
  const path = normalizeConfigPath(configPath);
  const info = await lstat(path);
  if (!info.isFile() || !privatePath(info)) {
    throw new Error('Dock credentials must be a private regular file');
  }
  const data = JSON.parse(await readFile(path, 'utf8'));
  const endpoint = new URL(data.endpoint);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password
      || endpoint.search || endpoint.hash || endpoint.pathname !== '/mcp') {
    throw new Error('Dock endpoint must be an HTTPS /mcp URL without credentials or query');
  }
  if (data.account !== 'loginom-dock' || data.user !== 'loginom-dock'
      || typeof data.api_key !== 'string' || !data.api_key.trim()) {
    throw new Error('The ordinary loginom-dock client identity and key are required');
  }
  let loginomUrl = null;
  if (data.loginom_url) {
    const target = new URL(data.loginom_url);
    if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.hash
        || [...target.searchParams.keys()].some(key => /token|password|secret|auth|api.?key/i.test(key))) {
      throw new Error('The Loginom address must not contain credentials');
    }
    loginomUrl = target.href;
  }
  return Object.freeze({
    endpoint: endpoint.href, apiKey: data.api_key, loginomUrl,
    account: data.account, user: data.user, agent, adapterRevision,
    stateDir: normalizeConfigPath(stateDir || join(homedir(), '.loginom-dock')),
  });
}
