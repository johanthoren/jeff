#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_BIN="${PYTHON_BIN:-python3}"
export PYTHONDONTWRITEBYTECODE=1
# Keep any fallback cache outside the shipped skills/ payload tree.
export PYTHONPYCACHEPREFIX="${TMPDIR:-/tmp}/jeff-pycache"

if ! command -v "$PYTHON_BIN" >/dev/null 2>&1; then
	echo "python3 is required for review-security" >&2
	exit 1
fi

exec "$PYTHON_BIN" -B "$SCRIPT_DIR/review_security.py" "$@"
