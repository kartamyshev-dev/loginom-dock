import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { executableExists, privateDirectory } from './platform.mjs';

const require = createRequire(import.meta.url);
const packagePath = (name) => require.resolve(`${name}/package.json`);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));

export async function createSession(config, { headless = false } = {}) {
  const expectedNode = (await readFile(new URL('../.node-version', import.meta.url), 'utf8')).trim();
  if (process.versions.node !== expectedNode) throw new Error(`Dock requires Node.js ${expectedNode}`);
  if (!['darwin', 'linux', 'win32'].includes(process.platform)) throw new Error('Dock supports macOS, Linux and Windows');
  if (!headless && process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
    throw new Error('A visible Dock browser requires a graphical session');
  }
  const id = randomUUID();
  const directory = join(config.stateDir, 'sessions', id);
  const profile = join(directory, 'browser-profile');
  const artifacts = join(directory, 'artifacts');
  await privateDirectory(config.stateDir);
  for (const path of [directory, profile, artifacts]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  const browserRoot = join(config.stateDir, 'runtime', 'browsers');
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserRoot;
  const { chromium } = await import('playwright-core');
  const executablePath = chromium.executablePath();
  await executableExists(executablePath);
  const mcp = await json(packagePath('@playwright/mcp'));
  // SDK's wildcard export resolves package.json inside dist/cjs, without version.
  const sdk = await json(join(dirname(packagePath('@modelcontextprotocol/sdk')), '..', '..', 'package.json'));
  const core = await json(packagePath('playwright-core'));
  const own = await json(new URL('../package.json', import.meta.url));
  const lock = await json(new URL('../package-lock.json', import.meta.url));
  if (mcp.version !== own.dependencies['@playwright/mcp']
      || sdk.version !== own.dependencies['@modelcontextprotocol/sdk']
      || core.version !== lock.packages['node_modules/playwright-core'].version) {
    throw new Error('Installed MCP dependencies do not match the Dock runtime pin');
  }
  const browsers = await json(join(dirname(packagePath('playwright-core')), 'browsers.json'));
  const chromiumRevision = browsers.browsers.find(item => item.name === 'chromium');
  const clientHash = createHash('sha256');
  for (const file of ['../.node-version', '../package.json', '../package-lock.json',
    '../bin/loginom-dock.mjs', './config.mjs', './session.mjs', './catalog.mjs',
    './bridge.mjs', './clipboard.mjs', './skill.mjs', './hooks.mjs', './history.mjs', './archive.mjs', './redact.mjs',
    '../bin/hook.mjs', '../bin/dispatch.mjs', './hook-runtime.mjs', './install.mjs', './diagnostics.mjs', '../../examples/memory-plugin-shared/lib/mcp-proxy-config.mjs',
    '../../examples/memory-plugin-shared/lib/batch-send.mjs', '../../examples/memory-plugin-shared/lib/capture-utils.mjs']) {
    clientHash.update(file + '\0').update(await readFile(new URL(file, import.meta.url)));
  }
  const browserConfig = join(directory, 'playwright.json');
  await writeFile(browserConfig, JSON.stringify({
    browser: { browserName: 'chromium', userDataDir: profile,
      launchOptions: { executablePath, headless }, contextOptions: { viewport: null } },
    capabilities: ['core', 'vision'], outputDir: artifacts,
    saveSession: false, timeouts: { action: 15000, navigation: 120000 },
  }), { mode: 0o600 });
  const releaseRoot = fileURLToPath(new URL('../../', import.meta.url));
  const releaseName = relative(join(config.stateDir, 'releases'), releaseRoot);
  const runtimeRelease = /^[0-9A-Za-z.+-]+-[a-f0-9]{12}$/.test(releaseName) ? releaseName : null;
  const metadata = {
    sessionId: id, agent: config.agent, adapterRevision: config.adapterRevision,
    node: process.versions.node, client: own.version, playwrightMcp: mcp.version,
    clientRevision: clientHash.digest('hex'),
    runtimeRelease,
    playwright: core.version, sdk: sdk.version,
    chromiumRevision: chromiumRevision.revision, chromiumVersion: chromiumRevision.browserVersion,
    profile, artifacts, archiveActive: false, skillRevision: null,
  };
  return {
    directory, metadata, browserRoot, browserConfig,
    browserCli: join(dirname(packagePath('@playwright/mcp')), 'cli.js'),
    async save(catalog) {
      await writeFile(join(directory, 'session.json'), JSON.stringify({
        ...metadata, toolCatalogSha256: catalog.sha256,
      }, null, 2) + '\n', { mode: 0o600 });
      await writeFile(join(directory, 'tools.json'), JSON.stringify(catalog.tools, null, 2) + '\n', { mode: 0o600 });
    },
  };
}
