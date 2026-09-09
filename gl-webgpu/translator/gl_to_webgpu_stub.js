// gl_to_webgpu_stub.js
// Minimal translator: accepts a JSON command stream and forwards to renderer.

function translateGLCommands(cmdStream) {
  // cmdStream: array of {cmd: "clear"|"draw", args: {...}}
  // For now, just forward unchanged.
  return cmdStream;
}

if (typeof module !== 'undefined') {
  module.exports = { translateGLCommands };
}
