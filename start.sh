#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Install Node 18+"; exit 1; }
[ -d node_modules/ws ] || npm install --no-audit --no-fund
exec node server.js "${PORT:-7179}"
