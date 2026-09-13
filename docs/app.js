// docs/app.js
// TinyEMU loader + Linux boot helper for GitHub Pages

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
  // If the module prints to stdout/stderr via Module.print/printErr, they are already set below.
  // If the module exposes a serial callback, you can hook it here.
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

async function startTinyEmuAndBoot() {
  vmOutput.textContent = "";
  appendVmLine("Loading tinyemu.js...");
  await loadScript("wasm/tinyemu.js");
  appendVmLine("tinyemu.js loaded.");

  // Fetch wasm manually to avoid MIME streaming issues
  const wasmBinary = await fetchArrayBuffer("wasm/tinyemu.wasm");
  appendVmLine("tinyemu.wasm fetched.");

  // Provide print hooks so module output goes to the page
  const moduleConfig = {
    wasmBinary,
    print: text => appendVmLine(String(text)),
    printErr: text => appendVmLine("ERR: " + String(text)),
    noInitialRun: true
  };

  appendVmLine("Instantiating TinyEmuModule...");
  const Module = await window.TinyEmuModule(moduleConfig);
  appendVmLine("TinyEmuModule instantiated.");

  installConsoleHooks(Module);

  // Fetch kernel and rootfs from wasm/ folder
  // Expected filenames: wasm/vmlinux and wasm/rootfs.cpio
  let kernelBuf, rootfsBuf;
  try {
    kernelBuf = await fetchArrayBuffer("wasm/vmlinux");
    rootfsBuf = await fetchArrayBuffer("wasm/rootfs.cpio");
  } catch (err) {
    appendVmLine("Warning: kernel or rootfs not found: " + err.message);
    appendVmLine("If you only want to test the module, upload vmlinux and rootfs.cpio to docs/wasm/");
    // Still continue so user can inspect Module exports
  }

  // Write files into Emscripten FS if present
  try {
    if (kernelBuf) {
      try { Module.FS.mkdir("/boot"); } catch (e) {}
      Module.FS.writeFile("/boot/vmlinux", new Uint8Array(kernelBuf));
      appendVmLine("Wrote /boot/vmlinux");
    }
    if (rootfsBuf) {
      try { Module.FS.mkdir("/rootfs"); } catch (e) {}
      Module.FS.writeFile("/rootfs/rootfs.cpio", new Uint8Array(rootfsBuf));
      appendVmLine("Wrote /rootfs/rootfs.cpio");
    }
  } catch (err) {
    appendVmLine("FS write error: " + err.message);
  }

  // Prepare emulator args
  // If you have initramfs (rootfs.cpio) use -initrd; if you have disk image use -drive style args
  const args = [];
  if (kernelBuf) {
    args.push("-kernel", "/boot/vmlinux");
  }
  if (rootfsBuf) {
    args.push("-initrd", "/rootfs/rootfs.cpio");
  }
  // Use serial console on ttyS0 and no graphical window
  args.push("-nographic");
  args.push("-append", "console=ttyS0 root=/dev/ram rw");

  appendVmLine("Emulator args: " + args.join(" "));

  // Build argv in Emscripten memory and call main
  // Many modularized Emscripten builds export _main
  try {
    const argc = args.length + 1;
    const argvPtrs = [];
    const argvBuffer = Module._malloc((argc + 1) * 4);
    let ptrOffset = argvBuffer;

    function writeStringToHeap(s) {
      const buf = Module._malloc(s.length + 1);
      Module.stringToUTF8(s, buf, s.length + 1);
      return buf;
    }

    // program name
    const progPtr = writeStringToHeap("tinyemu");
    Module.setValue(ptrOffset, progPtr, "i32");
    ptrOffset += 4;

    for (let i = 0; i < args.length; i++) {
      const p = writeStringToHeap(args[i]);
      Module.setValue(ptrOffset, p, "i32");
      ptrOffset += 4;
      argvPtrs.push(p);
    }
    Module.setValue(ptrOffset, 0, "i32"); // null terminator

    appendVmLine("Calling _main with argc=" + argc);
    // If your build exports a different entry point, adjust this call
    Module._main(argc, argvBuffer);
    appendVmLine("_main returned (if it returns).");
  } catch (err) {
    appendVmLine("Error calling main: " + err.message);
  }

  // If the build exposes a framebuffer pointer and size, render it periodically
  // Common pattern: module exports a function to get framebuffer pointer/size; adapt names if different
  try {
    if (Module._get_framebuffer_ptr && Module._get_framebuffer_width && Module._get_framebuffer_height) {
      const fbPtr = Module._get_framebuffer_ptr();
      const w = Module._get_framebuffer_width();
      const h = Module._get_framebuffer_height();
      appendVmLine("Framebuffer at " + fbPtr + " size " + w + "x" + h);
      function loopRender() {
        try {
          renderFramebuffer(Module, fbPtr, w, h);
        } catch (e) {}
        requestAnimationFrame(loopRender);
      }
      loopRender();
    } else {
      appendVmLine("No framebuffer exports detected. If you want graphics, rebuild with framebuffer exports.");
    }
  } catch (err) {
    appendVmLine("Framebuffer check error: " + err.message);
  }
}

startBtn.addEventListener("click", async () => {
  try {
    await startTinyEmuAndBoot();
  } catch (err) {
    appendVmLine("Failed to start VM: " + err.message);
  }
});

renderBtn.addEventListener("click", () => {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f0";
  ctx.font = "16px monospace";
  ctx.fillText("Renderer: placeholder frame", 10, 30);
});
