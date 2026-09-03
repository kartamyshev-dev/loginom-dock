#!/usr/bin/env python3
"""Create a small, credential-free client source snapshot for server-side builds."""

import argparse
import gzip
import hashlib
import json
import subprocess
import tarfile
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    root = args.root.resolve()
    directories = (
        "client/bin/",
        "client/lib/",
        "client/test/",
        "examples/memory-plugin-shared/lib/",
        "plugins/loginom-dock/",
        "plugins/loginom-dock-hermes/",
        "examples/codex-memory-plugin/",
    )
    individual = {
        "client/package.json",
        "client/package-lock.json",
        "client/.node-version",
        "client/README.md",
        "client/INSTALL.md",
        ".agents/plugins/marketplace.json",
        "LICENSE",
        "README_UPSTREAM.md",
        "deploy/loginom-dock/build-client-bundle.py",
    }
    known = (
        subprocess.check_output(
            ["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], cwd=root
        )
        .decode()
        .split("\0")
    )
    files = []
    for name in sorted(set(known)):
        path = Path(name)
        if not name or not (name in individual or name.startswith(directories)):
            continue
        if any(
            part in {"node_modules", "__pycache__", ".git"} or part.startswith(".env")
            for part in path.parts
        ):
            continue
        if (root / path).is_file() or (root / path).is_symlink():
            files.append(name)
    if "client/lib/hooks.mjs" not in files:
        raise SystemExit("Client sources are excluded by Git rules")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with (
        args.output.open("wb") as stream,
        gzip.GzipFile(fileobj=stream, mode="wb", mtime=0) as zipped,
        tarfile.open(fileobj=zipped, mode="w|") as tar,
    ):
        for name in files:
            info = tar.gettarinfo(str(root / name), arcname=name)
            info.uid = info.gid = info.mtime = 0
            info.uname = info.gname = ""
            if info.isfile():
                with (root / name).open("rb") as content:
                    tar.addfile(info, content)
            else:
                tar.addfile(info)
    print(
        json.dumps(
            {
                "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
                "files": len(files),
                "bytes": args.output.stat().st_size,
            }
        )
    )


if __name__ == "__main__":
    main()
