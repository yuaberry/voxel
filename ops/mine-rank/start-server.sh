#!/usr/bin/env bash
# Starts the Mine Rank server (vanilla 1.20.1) with a LIVE console pipe.
#
# The FIFO (`cmd.fifo`) is the server's stdin, so a command can be sent at
# any moment without restarting the server:
#
#   echo "say hello" > /home/llinux/Voxel/servers/mine-rank/cmd.fifo
#
# The FIFO is opened read-write (`exec 3<>`) on purpose: opening a FIFO
# read-only blocks until a writer shows up, and the server must boot even
# when nobody is at the console.
set -euo pipefail

cd "$(dirname "$0")"

FIFO="$PWD/cmd.fifo"
if [ ! -p "$FIFO" ]; then
  mkfifo "$FIFO"
fi

# never two servers on the same world — the port check is the guard
if command -v ss >/dev/null 2>&1 && ss -ltn | grep -q ':25565 '; then
  echo "[start-server] the port 25565 is already busy — refusing to start a second server" >&2
  exit 1
fi

exec 3<> "$FIFO"
exec java -Xms512M -Xmx2G -jar server.jar nogui <&3
