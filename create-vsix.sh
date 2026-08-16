#!/bin/bash

set -e

# Read version from package.json
VERSION=$(jq -r '.version' package.json)
VSIX_FILE="ghost-${VERSION}.vsix"

echo "Building VSIX package version ${VERSION}..."
npm run vscode:prepublish
npx vsce package --out "${VSIX_FILE}"

echo "✓ VSIX package created: ${VSIX_FILE}"
echo ""
echo "Installing extension..."
code --install-extension "./${VSIX_FILE}"
echo "✓ Extension installed"
