#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$ROOT_DIR/output}"
VSIX_PATH="${2:-}"

usage() {
  cat <<EOF
Usage: install-vscode.sh [out-dir] [vsix-path]

If no vsix-path is provided the script will pick the most recent .vsix from the output directory.
Example:
  ./install-vscode.sh            # installs latest VSIX from ./output
  ./install-vscode.sh ./output my-extension-1.2.3.vsix
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

if [[ -z "$VSIX_PATH" ]]; then
  VSIX_PATH=$(ls -1t "$OUT_DIR"/*.vsix 2>/dev/null | head -n1 || true)
fi

if [[ -z "$VSIX_PATH" || ! -f "$VSIX_PATH" ]]; then
  echo "No VSIX found in $OUT_DIR. Build the package with ./package.sh or pass a VSIX path." >&2
  usage
  exit 1
fi

if command -v code >/dev/null 2>&1; then
  CODE_CMD="code"
elif command -v code-insiders >/dev/null 2>&1; then
  CODE_CMD="code-insiders"
else
  echo "Could not find 'code' or 'code-insiders' CLI in PATH. Open VS Code and run 'Shell Command: Install 'code' command in PATH' from the Command Palette." >&2
  exit 1
fi

echo "Installing VSIX: $VSIX_PATH using $CODE_CMD"
"$CODE_CMD" --install-extension "$VSIX_PATH" --force

echo "Installation complete. You may need to restart VS Code to activate the extension."