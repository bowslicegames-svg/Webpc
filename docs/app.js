import { renderCommands } from '../gl-webgpu/web/renderer.js';

const vmOutput = document.getElementById('vm-output');
const startBtn = document.getElementById('start-vm');
const renderBtn = document.getElementById('render');
const canvas = document.getElementById('screen');

function appendVmLine(line) {
  vmOutput.textContent += line + '\n';
  vmOutput.scrollTop = vmOutput.scrollHeight;
}

async function loadTinyEmuScript(path) {
  return new Promise((resolve, reject) => {
    if (window.TinyEmuModule) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = path;
    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error('Failed to load tinyemu script: ' + path));
    document.head.appendChild(s);
  });
}

startBtn.addEventListener('click', async () => {
  vmOutput.textContent = '';
  appendVmLine('Loading TinyEmu WASM module...');

  try {
    // Adjust path if you moved build files. This expects wasm-vm/build/tinyemu.js relative to web/
    await loadTinyEmuScript('../wasm-vm/build/tinyemu.js');

    // Create module instance with custom print handlers
    const moduleConfig = {
      print: (text) => appendVmLine(String(text)),
      printErr: (text) => appendVmLine('ERR: ' + String(text)),
      noInitialRun: false
    };

    // TinyEmuModule is the function exported by the Emscripten modularized build
    const instancePromise = window.TinyEmuModule(moduleConfig);

    appendVmLine('Instantiating module...');
    await instancePromise;

    appendVmLine('TinyEmu WASM module started.');
  } catch (err) {
    appendVmLine('Failed to start TinyEmu: ' + err.message);
  }
});

renderBtn.addEventListener('click', async () => {
  const commands = [
    { cmd: 'clear' },
    { cmd: 'frame', data: 'placeholder-frame-bytes-0123456789' }
  ];
  await renderCommands(canvas, commands);
});
