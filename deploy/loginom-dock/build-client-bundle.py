#!/usr/bin/env python3
"""Assemble a checked client bundle on the Dock build host, without credentials."""

import argparse
import hashlib
import json
import os
import shutil
import tarfile
import zipfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--node-license", type=Path, required=True)
    parser.add_argument("--dependencies", type=Path, required=True)
    parser.add_argument("--platform", choices=["darwin-arm64", "linux-x64", "win32-x64"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--source-clean", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    target = args.output.resolve()
    windows = args.platform == "win32-x64"
    target.mkdir(parents=True, exist_ok=False)
    for relative in [
        "client/bin",
        "client/lib",
        "client/test",
        "examples/memory-plugin-shared/lib",
        "plugins/loginom-dock",
        "plugins/loginom-dock-hermes",
        "examples/codex-memory-plugin",
    ]:
        shutil.copytree(
            source / relative,
            target / relative,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".DS_Store"),
            symlinks=not windows,
        )
    for relative in [
        "client/package.json",
        "client/package-lock.json",
        "client/.node-version",
        "client/README.md",
        "client/INSTALL.md",
        ".agents/plugins/marketplace.json",
        "LICENSE",
        "README_UPSTREAM.md",
        "landing/instructions.mjs",
        "landing/release.json",
    ]:
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, destination)
    shutil.copytree(args.dependencies, target / "client/node_modules", symlinks=not windows)
    (target / "runtime").mkdir()
    node_name = "node.exe" if windows else "node"
    shutil.copyfile(args.node, target / "runtime" / node_name)
    (target / "runtime" / node_name).chmod(0o755)
    shutil.copyfile(args.node_license, target / "runtime/LICENSE.node")
    own = json.loads((target / "client/package.json").read_text())
    if windows:
        (target / "install.ps1").write_text(
            "$ErrorActionPreference = 'Stop'\r\n"
            "$dockBundle = Split-Path -LiteralPath $MyInvocation.MyCommand.Path -Parent\r\n"
            "& (Join-Path $dockBundle 'runtime\\node.exe') (Join-Path $dockBundle 'client\\bin\\setup.mjs') --bundle $dockBundle @args\r\n"
            "exit $LASTEXITCODE\r\n"
        )
        mcp_path = target / "plugins/loginom-dock/.mcp.json"
        mcp = json.loads(mcp_path.read_text())
        server = mcp["mcpServers"]["loginom-dock"]
        server["command"] = "cmd.exe"
        server["args"] = ["/d", "/s", "/c", f"call scripts\\launch.cmd mcp codex {own['version']}"]
        mcp_path.write_text(json.dumps(mcp, ensure_ascii=False, indent=2) + "\n")
    else:
        (target / "install.sh").write_text(
            '#!/bin/sh\nset -eu\ndock_bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)\n'
            'exec "$dock_bundle/runtime/node" "$dock_bundle/client/bin/setup.mjs" --bundle "$dock_bundle" "$@"\n'
        )
        (target / "install.sh").chmod(0o755)
    manifest = {
        "version": own["version"],
        "adapterRevision": own["version"],
        "node": (target / "client/.node-version").read_text().strip(),
        "platform": args.platform,
        "sourceCommit": args.source_commit,
        "sourceDirty": not args.source_clean,
        "agents": {"codex": {"minimum": "0.149.1"}, "hermes": {"minimum": "0.21.0"}},
        "files": [],
    }
    for path in sorted(target.rglob("*")):
        if path.is_symlink():
            content = os.readlink(path).encode()
        elif path.is_file():
            content = path.read_bytes()
        else:
            continue
        manifest["files"].append(
            {
                "path": path.relative_to(target).as_posix(),
                "sha256": hashlib.sha256(content).hexdigest(),
            }
        )
    (target / "release.json").write_text(json.dumps(manifest, sort_keys=True, indent=2) + "\n")
    archive = Path(str(target) + (".zip" if windows else ".tar.gz"))
    if windows:
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zipped:
            for path in sorted(target.rglob("*")):
                if path.is_file():
                    zipped.write(path, Path("loginom-dock") / path.relative_to(target))
    else:
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(target, arcname="loginom-dock")
    print(
        json.dumps(
            {
                "archive": str(archive),
                "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
                "files": len(manifest["files"]),
                "platform": args.platform,
            }
        )
    )


if __name__ == "__main__":
    main()
