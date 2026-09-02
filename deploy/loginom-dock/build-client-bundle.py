#!/usr/bin/env python3
"""Assemble a checked client bundle on the Dock build host, without credentials."""

import argparse
import hashlib
import json
import os
import shutil
import tarfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--node-license", type=Path, required=True)
    parser.add_argument("--dependencies", type=Path, required=True)
    parser.add_argument("--platform", choices=["darwin-arm64", "linux-x64"], required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--source-clean", action="store_true")
    args = parser.parse_args()
    source = args.source.resolve()
    target = args.output.resolve()
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
            symlinks=True,
        )
    for relative in [
        "client/package.json",
        "client/package-lock.json",
        "client/.node-version",
        "client/README.md",
        ".agents/plugins/marketplace.json",
        "LICENSE",
        "README_UPSTREAM.md",
    ]:
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, destination)
    shutil.copytree(args.dependencies, target / "client/node_modules", symlinks=True)
    (target / "runtime").mkdir()
    shutil.copyfile(args.node, target / "runtime/node")
    (target / "runtime/node").chmod(0o755)
    shutil.copyfile(args.node_license, target / "runtime/LICENSE.node")
    (target / "install.sh").write_text(
        '#!/bin/sh\nset -eu\ndock_bundle=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)\n'
        'exec "$dock_bundle/runtime/node" "$dock_bundle/client/bin/setup.mjs" --bundle "$dock_bundle" "$@"\n'
    )
    (target / "install.sh").chmod(0o755)
    own = json.loads((target / "client/package.json").read_text())
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
    archive = Path(str(target) + ".tar.gz")
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
