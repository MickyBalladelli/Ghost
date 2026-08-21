#!/bin/bash

set -e

# Read the package identity from package.json. This helper does not bump the
# version; bump and review package.json, README, and CHANGELOG before packaging.
PACKAGE_NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
VSIX_FILE="${PACKAGE_NAME}-${VERSION}.vsix"

echo "Building VSIX package version ${VERSION}..."
npm run package

if [ ! -f "./${VSIX_FILE}" ]; then
  echo "Expected ${VSIX_FILE} after npm run package" >&2
  exit 1
fi

echo "✓ VSIX package created: ${VSIX_FILE}"
echo ""
echo "Installing extension..."
code --install-extension "./${VSIX_FILE}" --force
echo "✓ Extension installed"
