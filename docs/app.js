// docs/app.js
// Manual WASM loader that works on GitHub Pages (fixes MIME type errors)

const vmOutput = document.getElementById("vm-output");
const startBtn = document.getElementById("start-vm");
const renderBtn = document.getElementById("render");
const canvas = document.getElementById("screen");

// Append text to VM console
function appendVmLine(line) {
  vmOutput.textContent += line + "\n";
  vmOutput.scrollTop = vmOutput.scrollHeight;
}

// Capture all JS errors (important for iPad debugging)
window.addEventListener("error", e => {
  appendVmLine("Global error: " + (e.message || e));
});
window.addEventListener("unhandledrejection", e => {
  appendVmLine("Unhandled rejection: " + (e.reason?.message || e.reason));
});

// Load tinyemu.js (modularized Emscripten wrapper)
async function loadTinyEmuScript() {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "wasm/tinyemu.js";   // GitHub Pages serves /docs as root
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load tinyemu.js"));
    document.head.appendChild(s);
  });
}

// Manual WASM loader (fixes MIME type issues)
async function loadWasmBinary() {
  appendVmLine("Fetching tinyemu.wasm manually...");
  const response = await fetch("wasm/tinyemu.wasm");
  if (!response.ok) {
    throw new Error("Failed to fetch tinyemu.wasm: " + response.status);
  }
  return await response.arrayBuffer();
}

startBtn.addEventListener("click", async () => {
  vmOutput.textContent = "";
  appendVmLine("Loading TinyEmu WASM module...");

  try {
    // Load JS wrapper
    await loadTinyEmuScript();
    appendVmLine("tinyemu.js loaded.");

    // Load WASM manually
    const wasmBinary = await loadWasmBinary();
    appendVmLine("tinyemu.wasm fetched.");

    // Instantiate WASM manually
    appendVmLine("Instantiating WASM manually...");
    const moduleConfig = {
      wasmBinary,
      print: text => appendVmLine(String(text)),
      printErr: text => appendVmLine("ERR: " + String(text)),
      noInitialRun: false
    };

    const instance = await window.TinyEmuModule(moduleConfig);
    appendVmLine("TinyEmu WASM module started.");

  } catch (err) {
    appendVmLine("Failed to start VM: " + err.message);
  }
});

// Simple renderer demo
renderBtn.addEventListener("click", () => {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f0";
  ctx.font = "16px monospace";
  ctx.fillText("Renderer: placeholder frame", 10, 30);
});
