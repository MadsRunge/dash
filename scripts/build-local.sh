#!/bin/bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Dash"
DEST="/Applications/$APP_NAME.app"

# Detect architecture
ARCH=$(uname -m)
if [ "$ARCH" = "x86_64" ]; then
  echo "==> Detected Intel (x64) architecture"
  BUILDER_ARGS="--mac --x64"
else
  echo "==> Detected Apple Silicon (arm64) architecture"
  BUILDER_ARGS="--mac --arm64"
fi

echo "==> Rebuilding native modules for Electron..."
cd "$ROOT"
pnpm exec electron-rebuild -f -w better-sqlite3,node-pty

echo "==> Building $APP_NAME..."
pnpm build

echo "==> Packaging for macOS ($ARCH)..."
# Clean release dir to avoid finding old builds
rm -rf "$ROOT/release/mac"*
pnpm exec electron-builder $BUILDER_ARGS

# Find the built app dynamically (since it could be under 'mac/' or 'mac-arm64/')
APP_PATH=$(find "$ROOT/release" -name "$APP_NAME.app" -type d | head -n 1)

if [ -z "$APP_PATH" ]; then
  echo "Error: Could not find $APP_NAME.app in release directory."
  exit 1
fi

echo "==> Ad-hoc signing $APP_PATH..."
codesign --force --deep --sign - --entitlements "$ROOT/build/entitlements.mac.plist" "$APP_PATH"
codesign --verify --verbose "$APP_PATH"

echo "==> Moving to /Applications..."
if [ -d "$DEST" ]; then
  rm -rf "$DEST"
fi
cp -R "$APP_PATH" "$DEST"

echo "==> Done! $APP_NAME installed to /Applications"