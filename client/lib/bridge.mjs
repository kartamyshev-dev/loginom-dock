import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';
import { readCatalog, combineCatalogs } from './catalog.mjs';
import { acquireClipboard, makeClipboardCode, hasClipboardConfirmation, createSerialGate, clipboardTool } from './clipboard.mjs';
import { createSkillLoader, skillTransport, skillUri, prepareTool } from './skill.mjs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { openArchive } from './archive.mjs';
import { diagnoseConnection } from './diagnostics.mjs';

const diagnosticTool = {
  name: 'dock_diagnostics', description: 'Inspect the pinned Dock runtime and archive, and check Dock, sources, skill and Loginom connectivity. Does not activate archiving or log in to Loginom.',
  inputSchema: { type: 'object', properties: { checkConnections: { type: 'boolean', default: true } }, additionalProperties: false },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
};

export async function createBridge(config, session) {
  const remote = new Client({ name: 'loginom-dock', version: session.metadata.client });
  const browser = new Client({ name: 'loginom-dock-browser', version: session.metadata.client });
  const remoteTransport = new StreamableHTTPClientTransport(new URL(config.endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${config.apiKey}` }, redirect: 'error' },
  });
  const browserTransport = new StdioClientTransport({
    command: process.execPath,
    args: [session.browserCli, '--config', session.browserConfig],
    env: { ...getDefaultEnvironment(), PLAYWRIGHT_BROWSERS_PATH: session.browserRoot },
    cwd: session.directory, stderr: 'pipe',
  });
  // Browser stderr may contain page details; never persist or forward it to logs.
  browserTransport.stderr?.on('data', () => {});
  const closeClients = () => Promise.allSettled([remote.close(), browser.close()]);
  const browserGate = createSerialGate();
  const heldLeases = new Set();
  const skill = createSkillLoader({ directory: session.directory, transport: skillTransport(config) });
  let clipboardUncertain = false;
  try {
    const connections = await Promise.allSettled([remote.connect(remoteTransport), browser.connect(browserTransport)]);
    const failed = connections.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    const [remoteTools, browserTools] = await Promise.all([readCatalog(remote), readCatalog(browser)]);
    if (!browserTools.some(tool => tool.name === 'browser_run_code_unsafe')) {
      throw new Error('The pinned browser runtime lacks the verified clipboard execution tool');
    }
    const catalog = combineCatalogs({ remote: remoteTools, browser: browserTools, local: [diagnosticTool, clipboardTool, prepareTool] });
    await session.save(catalog);
    const server = new Server({ name: 'loginom-dock', version: session.metadata.client }, {
      capabilities: { tools: {} },
      instructions: 'Call dock_prepare before Loginom work to load the verified full skill into the current context. Dock provides shared knowledge and a local browser. Source files and live DOM take precedence over recalled context. All clipboard copy/paste must use dock_clipboard_transfer so other Dock sessions cannot overwrite it during the operation. The installed native adapter activates shared session archiving after successful preparation. Check dock_diagnostics for actual archive activation and delivery state.',
    });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: structuredClone(catalog.tools) }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const owner = catalog.routes.get(request.params.name);
      if (!owner) throw new McpError(ErrorCode.InvalidParams, 'Unknown Dock tool');
      if (request.params.name === 'dock_diagnostics') {
        let archive = null;
        try { archive = JSON.parse(await readFile(join(session.directory, 'archive.json'), 'utf8')); } catch {}
        if (archive?.serverSession) {
          const queue = await openArchive(config);
          try {
            archive.delivery = queue.deliveryStatus(archive.serverSession);
            archive.pendingEvents = archive.delivery.pending_events;
            archive.installationPendingEvents = queue.pendingCount();
          }
          finally { queue.close(); }
        }
        session.metadata.archiveActive = archive?.active === true;
        const connection = request.params.arguments?.checkConnections === false ? null : await diagnoseConnection(config);
        return { content: [{ type: 'text', text: JSON.stringify({
        ...session.metadata, endpoint: config.endpoint, loginomUrl: config.loginomUrl, toolCatalogSha256: catalog.sha256,
        remoteTools: remoteTools.length, browserTools: browserTools.length,
        clipboardTransferAvailable: true, clipboardUncertain, archive, connection,
      }) }] };
      }
      try {
        if (request.params.name === 'dock_prepare') {
          const prepared = await skill.prepare();
          session.metadata.skillRevision = prepared.detail.revision;
          session.metadata.skillPath = prepared.main;
          await session.save(catalog);
          return { content: [{ type: 'text', text: JSON.stringify({
            prepared: true, sessionId: session.metadata.sessionId,
            loginomUrl: config.loginomUrl,
            skillUri, skillRevision: prepared.detail.revision, cacheDirectory: prepared.directory,
            source: prepared.detail.source, archiveActive: session.metadata.archiveActive,
          }) }, { type: 'text', text: prepared.detail.content }] };
        }
        if (owner === 'remote') return await remote.callTool(request.params, undefined, {
          signal: extra.signal, timeout: 360000,
        });
        return await browserGate(async () => {
          extra.signal.throwIfAborted();
          if (clipboardUncertain) throw new Error('Clipboard completion is uncertain; restart this Dock client before further browser operations');
          if (request.params.name !== 'dock_clipboard_transfer') {
            return browser.callTool(request.params, undefined, { signal: extra.signal, timeout: 360000 });
          }
          const { code, token } = makeClipboardCode(request.params.arguments);
          const lease = await acquireClipboard({ signal: extra.signal });
          heldLeases.add(lease);
          let completed = false;
          try {
            // Once copy starts, cancellation must not release the host lease while
            // the browser could still paste. Wait for a terminal browser result.
            const result = await browser.callTool({ name: 'browser_run_code_unsafe', arguments: { code } }, undefined, { timeout: 360000 });
            completed = true;
            if (!hasClipboardConfirmation(result, token)) {
              return { isError: true, content: [{ type: 'text', text: 'Clipboard operation ended without confirmed paste. Inspect the target DOM before retrying.' }] };
            }
            return { content: [{ type: 'text', text: 'Copy and paste completed; the target DOM confirmed the result.' }] };
          } finally {
            if (completed) { await lease.release(); heldLeases.delete(lease); }
            else clipboardUncertain = true; // Keep the lease until browser shutdown.
          }
        });
      } catch (error) {
        const message = String(error.message).replaceAll(config.apiKey, '[redacted]');
        return { isError: true, content: [{ type: 'text', text: message }] };
      }
    });
    let closing;
    return { server, catalog, close() {
      closing ??= (async () => {
        await server.close(); await closeClients();
        await Promise.allSettled([...heldLeases].map(lease => lease.release()));
      })();
      return closing;
    } };
  } catch (error) {
    await closeClients();
    throw error;
  }
}
