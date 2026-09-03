// The same selection drives the archive, checksum and commands shown to the user.
export function installation(release, agent, platform) {
  if (!['codex', 'hermes'].includes(agent) || !['darwin-arm64', 'linux-x64'].includes(platform)) throw new Error('Unsupported installation selection');
  const entry = release.platforms[platform];
  const filename = `loginom-dock-${release.version}-${platform}.tar.gz`;
  return {
    filename,
    url: `${release.downloadBase}/${filename}`,
    checksum: `${platform === 'darwin-arm64' ? 'shasum -a 256' : 'sha256sum'} ${filename}`,
    install: `tar -xzf ${filename}\ncd loginom-dock\n./install.sh --agent ${agent}`,
    sha256: entry.sha256,
    size: `${(entry.bytes / 1048576).toFixed(1).replace('.', ',')} МБ`,
    update: `./install.sh --agent ${agent} --config-from "$HOME/.loginom-dock/config.json"`,
    rollback: `./install.sh --agent ${agent} --rollback`,
    uninstall: `./install.sh --agent ${agent} --uninstall`,
  };
}
