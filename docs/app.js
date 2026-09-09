// docs/app.js
// TinyEMU WASM loader for GitHub Pages (served from /docs)

const vmOutput = document.getElementById('vm-output');
const startBtn = document.getElementById('start-vm');
const renderBtn = document.getElementById('render');
const canvas = document.getElementById('screen');

// Append text to VM console
function appendVmLine(line) {
  vmOutput.textContent += line + "\n";
  vmOutput.scrollTop = vmOutput.scrollHeight;
}

// Global error capture (important for iPad debugging)
window.addEventListener('error', e => {
  appendVmLine("Global error: " + (e.message || e));
});
window.addEventListener('unhandledrejection', e => {
  appendVmLine("Unhandled rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason));
});

// Load tinyemu.js dynamically
async function loadTinyEmuScript(path) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = path;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load script: " + path));
    document.head.appendChild(s);
  });
}

// Start VM button
startBtn.addEventListener('click', async () => {
  vmOutput.textContent = "";
  appendVmLine("Loading TinyEmu WASM module...");

  try {
    // GitHub Pages serves /docs as root → wasm/tinyemu.js is correct
    await loadTinyEmuScript("wasm/tinyemu.js");

    appendVmLine("Script loaded. Instantiating module...");

    const moduleConfig = {
      print: (text) => appendVmLine(String(text)),
      printErr: (text) => appendVmLine("ERR: " + String(text)),
      noInitialRun: false
    };

    // TinyEmuModule is created by the modularized Emscripten build
    const instance = await window.TinyEmuModule(moduleConfig);

    appendVmLine("TinyEmu WASM module started.");
  } catch (err) {
    appendVmLine("Failed to start VM: " + err.message);
  }
});

// Simple renderer demo
renderBtn.addEventListener('click', () => {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f0";
  ctx.font = "16px monospace";
  ctx.fillText("Renderer: placeholder frame", 10, 30);
});
