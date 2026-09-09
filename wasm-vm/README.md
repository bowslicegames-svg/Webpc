# wasm-vm

This folder contains a minimal C program compiled to WebAssembly with Emscripten.

## Requirements
- Emscripten SDK installed and activated. See https://emscripten.org/docs/getting_started/downloads.html

## Build
From repo root:
  cd wasm-vm
  make

The build produces:
  build/tinyemu.js
  build/tinyemu.wasm

Copy the build folder to `web/wasm/` or serve the repo root so `web/app.js` can load `../wasm-vm/build/tinyemu.js`.
