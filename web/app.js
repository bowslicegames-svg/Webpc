import { renderCommands } from '../gl-webgpu/web/renderer.js';

const vmOutput = document.getElementById('vm-output');
const startBtn = document.getElementById('start-vm');
const renderBtn = document.getElementById('render');
const canvas = document.getElementById('screen');

startBtn.addEventListener('click', async () => {
  vmOutput.textContent = 'Starting VM stub...\n';
  // In a real build, fetch and instantiate the WASM VM here.
  vmOutput.textContent += 'VM started (stub). You can replace this with a real WASM VM.\n';
});

renderBtn.addEventListener('click', async () => {
  const commands = [
    { cmd: 'clear' },
    { cmd: 'frame', data: 'placeholder-frame-bytes-0123456789' }
  ];
  await renderCommands(canvas, commands);
});
