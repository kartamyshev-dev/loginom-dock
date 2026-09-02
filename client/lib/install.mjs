import { readFile, lstat, readdir, mkdir, cp, writeFile, rename, symlink, readlink, rm } from 'node:fs/promises';
import { join, resolve, dirname, relative } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safePath = value => typeof value === 'string' && !value.startsWith('/') && value.split('/').every(part => part && part !== '.' && part !== '..') && !/[\\\x00-\x1f]/.test(value);
export async function verifyBundle(bundle, { checkNode = true } = {}) {
  const raw = await readFile(join(bundle, 'release.json'));
  const manifest = JSON.parse(raw);
  if (manifest.platform !== `${process.platform}-${process.arch}` || (checkNode && manifest.node !== process.versions.node)) throw new Error('Unsupported Dock runtime platform or Node version');
  if (!/^[0-9A-Za-z.+-]+$/.test(manifest.version) || !Array.isArray(manifest.files)) throw new Error('Invalid Dock release');
  const listed = new Set(['release.json']);
  for (const file of manifest.files) {
    if (!safePath(file.path) || listed.has(file.path)) throw new Error('Unsafe Dock release path');
    listed.add(file.path);
    const path = join(bundle, file.path);
    const info = await lstat(path);
    if (info.isSymbolicLink()) {
      const target = await readlink(path);
      const resolved = relative(bundle, resolve(dirname(path), target));
      if (!safePath(resolved) || hash(target) !== file.sha256) throw new Error('Unsafe Dock release symlink');
    } else if (!info.isFile() || hash(await readFile(path)) !== file.sha256) throw new Error('Dock release checksum mismatch');
  }
  async function walk(directory, prefix = '') {
    for (const file of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + file.name;
      if (file.isDirectory()) await walk(join(directory, file.name), name + '/');
      else if (!listed.has(name)) throw new Error('Unexpected Dock release file');
    }
  }
  await walk(bundle);
  return { ...manifest, id: manifest.version + '-' + hash(raw).slice(0, 12) };
}

async function privateDirectory(path) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || (stat.mode & 0o077)) throw new Error('Dock directory must have mode 0700');
}
async function replaceLink(root, name, target) {
  const pending = join(root, '.' + name + '-' + randomUUID());
  await symlink(target, pending);
  try { await rename(pending, join(root, name)); }
  finally { await rm(pending, { force: true }); }
}
export async function installBundle(bundle, root) {
  const manifest = await verifyBundle(bundle);
  await privateDirectory(root);
  await privateDirectory(join(root, 'releases'));
  const destination = join(root, 'releases', manifest.id);
  let existing = false;
  try { await lstat(destination); existing = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if ((await verifyBundle(destination)).id !== manifest.id) throw new Error('Installed release has changed');
  } else {
    const pending = destination + '-' + randomUUID();
    try {
      await cp(bundle, pending, { recursive: true, verbatimSymlinks: true });
      await verifyBundle(pending);
      await rename(pending, destination);
    } finally { await rm(pending, { recursive: true, force: true }); }
  }
  const target = relative(root, destination);
  const previous = await readlink(join(root, 'current')).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
  if (previous && previous !== target) await replaceLink(root, 'previous', previous);
  await replaceLink(root, 'current', target);
  await privateDirectory(join(root, 'bin'));
  const launcher = '#!/bin/sh\nset -eu\ndock_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)\nexport LOGINOM_DOCK_HOME="$dock_root"\ndock_release=$(CDPATH= cd -- "$dock_root/current" && pwd -P)\nexec "$dock_release/runtime/node" "$dock_release/client/bin/dispatch.mjs" "$@"\n';
  const temporary = join(root, 'bin', '.loginom-dock-' + randomUUID());
  await writeFile(temporary, launcher, { mode: 0o700 });
  await rename(temporary, join(root, 'bin/loginom-dock'));
  return { manifest, destination, previous };
}

export async function rollbackBundle(root) {
  const previous = await readlink(join(root, 'previous'));
  if (!safePath(previous) || !previous.startsWith('releases/')) throw new Error('Invalid Dock rollback target');
  await verifyBundle(join(root, previous));
  const current = await readlink(join(root, 'current'));
  await replaceLink(root, 'current', previous);
  await replaceLink(root, 'previous', current);
  return previous;
}

export async function restoreRuntime(root, target) {
  if (target === null) { await rm(join(root, 'current'), { force: true }); return; }
  if (!safePath(target) || !/^releases\/[0-9A-Za-z.+-]+$/.test(target)) throw new Error('Invalid Dock recovery target');
  await verifyBundle(join(root, target), { checkNode: false });
  await replaceLink(root, 'current', target);
}
