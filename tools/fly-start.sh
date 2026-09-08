#!/bin/sh
# Container entrypoint for Fly.io.
#
# Fly mounts the persistent volume at /app/data, and a freshly created volume is
# owned by root. The app runs as `node` and would fail its first write — which on
# this app means "cannot create the database", and the machine boot-loops.
#
# So: start as root, fix the mount, drop to `node`. Nothing but the chown ever
# runs as root, and `exec` means node is PID 1 and receives Fly's shutdown signal
# directly rather than through a shell that would swallow it.
set -e

chown -R node:node /app/data 2>/dev/null || true

# --no-warnings matters: node:sqlite is experimental in Node 22 and prints to
# stderr on every boot, which some log collectors read as a failed start.
exec su node -s /bin/sh -c 'exec node --no-warnings server.js'
