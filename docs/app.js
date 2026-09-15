// docs/app.js
// TinyEMU loader + Linux boot helper for GitHub Pages
// Regenerated: yield after every 5 parts, safe yields for Chrome on iPad.

const vmOutput = document.getElementById("vm-output");
const startBtn = document.getElementById("start-vm");
const renderBtn = document.getElementById("render");
const canvas = document.getElementById("screen");

function appendVmLine(line) {
  vmOutput.textContent += line + "\n";
  vmOutput.scrollTop = vmOutput.scrollHeight;
}

window.addEventListener("error", e => {
  appendVmLine("Global error: " + (e.message || e));
});
window.addEventListener("unhandledrejection", e => {
  appendVmLine("Unhandled rejection: " + (e.reason?.message || e.reason));
});

async function loadScript(path) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = path;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load script: " + path));
    document.head.appendChild(s);
  });
}

async function fetchArrayBuffer(path) {
  appendVmLine("Fetching " + path);
  const resp = await fetch(path, { cache: "no-store" });
  appendVmLine("HTTP " + resp.status + " " + resp.statusText);
  if (!resp.ok) throw new Error("Failed to fetch " + path + " HTTP " + resp.status);
  const ab = await resp.arrayBuffer();
  appendVmLine("Fetched bytes: " + ab.byteLength);
  return ab;
}

function installConsoleHooks(Module) {
  if (!Module) return;
  if (Module.print) Module.print = text => appendVmLine(String(text));
  if (Module.printErr) Module.printErr = text => appendVmLine("ERR: " + String(text));
}

function renderFramebuffer(Module, fbPtr, width, height) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  const image = ctx.createImageData(width, height);
  const heap = Module.HEAPU8.buffer;
  const fbBytes = new Uint8Array(heap, fbPtr, width * height * 4);
  image.data.set(fbBytes);
  ctx.putImageData(image, 0, 0);
}

function initModule(moduleConfig) {
  return new Promise((resolve, reject) => {
    if (typeof window.TinyEmuModule === "function") {
      try {
        const maybePromise = window.TinyEmuModule(moduleConfig);
        if (maybePromise && typeof maybePromise.then === "function") {
          maybePromise.then(mod => resolve(mod)).catch(reject);
        } else {
          resolve(maybePromise);
        }
      } catch (err) {
        reject(err);
      }
      return;
    }

    try {
      const existing = window.Module || {};
      const merged = Object.assign({}, existing, moduleConfig);
      window.Module = merged;

      if (window.Module && window.Module.calledRun) {
        return resolve(window.Module);
      }

      const prev = window.Module.onRuntimeInitialized;
      window.Module.onRuntimeInitialized = function () {
        try { if (typeof prev === "function") prev(); } finally { resolve(window.Module); }
      };
    } catch (err) {
      reject(err);
    }
  });
}

/*
  Disk assembler (yield after every 5 parts)
  - Micro-yield: 1ms inside each chunk
  - Safe yield: 5ms after every 5 parts
  - Reader resume kick: 0ms after each part
*/
async function assembleDiskFromParts(Module, opts) {
  opts = opts || {};
  const maxPartIndex = opts.maxPartIndex ?? 30;
  const part—
