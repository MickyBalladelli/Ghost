#!/bin/bash

set -e

# Bump the patch version before building
npm version patch --no-git-tag-version --ignore-scripts

# Read the package identity from package.json
PACKAGE_NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="${PACKAGE_NAME}-${VERSION}.vsix"

echo "Building VSIX package version ${VERSION}..."
npm run vscode:prepublish
node ./scripts/archiveVsix.js
npx vsce package --out "${VSIX_FILE}"

echo "✓ VSIX package created: ${VSIX_FILE}"
echo ""
echo "Installing extension..."
code --install-extension "./${VSIX_FILE}" --force
echo "✓ Extension installed"
