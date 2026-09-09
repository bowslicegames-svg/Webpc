// renderer.js
// Minimal renderer that consumes a command stream and paints to a canvas.

export async function renderCommands(canvas, commands) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    console.error('2D context not available');
    return;
  }
  // Simple demo: clear and draw text
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0f0';
  ctx.font = '16px monospace';
  ctx.fillText('Renderer: received ' + commands.length + ' commands', 10, 30);
  // If commands contain a frame blob, show placeholder
  for (let i = 0; i < commands.length; i++) {
    const c = commands[i];
    if (c.cmd === 'frame' && c.data) {
      ctx.fillText('Frame data: ' + c.data.slice(0, 40), 10, 60 + i*20);
    }
  }
}
