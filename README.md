# browser-linux-mc

Minimal scaffold to build a browser-hosted local Linux VM with a GPU bridge for running native apps (prototype).

## Goals
- Run a tiny Linux userland inside WebAssembly in the browser.
- Provide a fake GPU device that forwards GL calls to a browser-side WebGPU renderer.
- Provide a JVM path to run Java apps (eventually the real Minecraft Launcher).

## Quickstart
1. Clone repo
2. Run `./build.sh`
3. Open `web/index.html` in a static server (or use `npx http-server web`)

## Structure
See repository tree in README.

## Notes
This is a starting point. Replace stubs with real implementations as you progress.
