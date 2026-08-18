#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VERSION="$(node -p "require('./package.json').version")"
PACKAGE_NAME="$(node -p "require('./package.json').name")"
VSIX_FILE="${PACKAGE_NAME}-${VERSION}.vsix"

if [[ ! -f "$VSIX_FILE" ]]; then
  echo "Error: ${VSIX_FILE} not found. Run ./create-vsix.sh first."
  exit 1
fi

echo "Publishing ${VSIX_FILE}..."
npx --no-install vsce publish --packagePath "$VSIX_FILE"
echo "✓ Published ${VSIX_FILE}"
