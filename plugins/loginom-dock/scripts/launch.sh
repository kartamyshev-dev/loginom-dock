#!/bin/sh
set -eu
dock_root=${LOGINOM_DOCK_HOME:-"$HOME/.loginom-dock"}
if [ ! -x "$dock_root/bin/loginom-dock" ]; then
  echo 'Loginom Dock: сначала завершите мастер подключения и установку среды Dock.' >&2
  exit 1
fi
exec "$dock_root/bin/loginom-dock" "$@"
