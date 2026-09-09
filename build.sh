#!/usr/bin/env bash
set -e
echo "Top-level build script — runs submodule builds where present."

echo "Building wasm-vm..."
if [ -f wasm-vm/Makefile ]; then
  (cd wasm-vm && make)
else
  echo "No Makefile in wasm-vm — skip"
fi

echo "Building fake-gpu userland..."
if [ -f fake-gpu/userland/Makefile ]; then
  (cd fake-gpu/userland && make)
else
  echo "No Makefile in fake-gpu/userland — skip"
fi

echo "Done. To run the web demo, serve the web/ directory with a static server."
