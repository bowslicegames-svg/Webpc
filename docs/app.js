// docs/app.js
// TinyEMU loader + Linux boot helper for GitHub Pages
// Pure in‑memory FS: no IDBFS, no syncfs, no persistence.
// Index.html is in /docs and wasm files are in /docs/wasm/, parts are in /docs/wasm/parts/

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
  Pure in‑memory disk assembler
  - No IDBFS, no syncfs, no persistence.
  - Streams each part from /wasm/parts/disk.raw.partXX
  - Writes in 64 KiB chunks to /rootfs/disk.raw
  - Micro‑yield (1ms) inside chunk loop to keep Chrome iPad responsive.
*/
async function assembleDiskFromParts(Module) {
  appendVmLine("Assembling disk.raw from /wasm/parts/... (in‑memory)");

  if (!Module || !Module.FS) {
    appendVmLine("Module.FS not available; cannot assemble disk.");
    throw new Error("FS not available");
  }

  // Ensure /rootfs exists (in‑memory only)
  try { Module.FS.mkdir("/rootfs"); } catch (e) {}

  // Create fresh disk.raw each run (no resume, no persistence)
  let fd;
  try {
    Module.FS.writeFile("/rootfs/disk.raw", new Uint8Array(0));
    fd = Module.FS.open("/rootfs/disk.raw", "r+");
  } catch (e) {
    appendVmLine("Failed to open /rootfs/disk.raw: " + (e && e.message ? e.message : e));
    throw e;
  }

  let pos = 0;
  let partsWritten = 0;
  const CHUNK = 64 * 1024;
  const microYield = () => new Promise(r => setTimeout(r, 1));

  for (let i = 0; i <= 30; i++) {
    const partName = `wasm/parts/disk.raw.part${String(i).padStart(2, "0")}`;
    appendVmLine("Fetching " + partName);

    let resp;
    try {
      resp = await fetch(partName, { cache: "no-store" });
    } catch (e) {
      appendVmLine("Fetch error for " + partName + ": " + (e && e.message ? e.message : e));
      break;
    }

    if (!resp.ok) {
      appendVmLine("No more parts (HTTP " + resp.status + ")");
      break;
    }

    const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;

    if (!reader) {
      // Fallback: whole buffer, still chunked writes
      const ab = await resp.arrayBuffer();
      const view = new Uint8Array(ab);
      let offset = 0;
      while (offset < view.length) {
        const end = Math.min(offset + CHUNK, view.length);
        const slice = view.subarray(offset, end);
        Module.FS.write(fd, slice, 0, slice.length, pos);
        pos += slice.length;
        offset = end;
        await microYield();
      }
    } else {
      // Streaming path
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        let offset = 0;
        while (offset < chunk.length) {
          const end = Math.min(offset + CHUNK, chunk.length);
          const slice = chunk.subarray(offset, end);
          Module.FS.write(fd, slice, 0, slice.length, pos);
          pos += slice.length;
          offset = end;
          await microYield();
        }
      }
    }

    partsWritten++;
    appendVmLine(`Appended part ${i}, total bytes: ${pos}`);
  }

  try { Module.FS.close(fd); } catch (e) {}
  appendVmLine("disk.raw assembled (in‑memory), final size " + pos + " bytes");

  return pos;
}

async function startTinyEmuAndBoot() {
  vmOutput.textContent = "";
  appendVmLine("Loading tinyemu.js...");
  await loadScript("wasm/tinyemu.js");
  appendVmLine("tinyemu.js loaded.");

  const wasmBinary = await fetchArrayBuffer("wasm/tinyemu.wasm");
  appendVmLine("tinyemu.wasm fetched.");

  const Module = await initModule({
    wasmBinary,
    print: text => appendVmLine(String(text)),
    printErr: text => appendVmLine("ERR: " + String(text)),
    noInitialRun: true
  });

  appendVmLine("TinyEmuModule instantiated.");
  installConsoleHooks(Module);

  // Fetch kernel (vmlinux)
  let kernelBuf;
  try {
    kernelBuf = await fetchArrayBuffer("wasm/vmlinux");
  } catch (err) {
    appendVmLine("Kernel missing: " + (err && err.message ? err.message : err));
    return;
  }

  // Write kernel into FS (in‑memory)
  try {
    try { Module.FS.mkdir("/boot"); } catch (e) {}
    Module.FS.writeFile("/boot/vmlinux", new Uint8Array(kernelBuf));
    appendVmLine("Wrote /boot/vmlinux");
  } catch (err) {
    appendVmLine("FS write error (kernel): " + (err && err.message ? err.message : err));
  }

  // Assemble disk.raw in memory
  let diskSize = 0;
  try {
    diskSize = await assembleDiskFromParts(Module);
    if (diskSize === 0) {
      appendVmLine("No disk parts found; disk.raw size is 0. Boot may still proceed if kernel doesn't require disk.");
    }
  } catch (err) {
    appendVmLine("Disk assembly failed: " + (err && err.message ? err.message : err));
  }

  const args = [
    "-kernel", "/boot/vmlinux",
    "-drive", "file=/rootfs/disk.raw,format=raw,if=none,id=hd0",
    "-device", "virtio-blk-device,drive=hd0",
    "-append", "console=ttyS0 root=/dev/vda rw",
    "-nographic"
  ];

  appendVmLine("Emulator args: " + args.join(" "));

  try {
    if (typeof Module.callMain === "function") {
      appendVmLine("Using Module.callMain (classic build).");
      Module.callMain(["tinyemu", ...args]);
      appendVmLine("Module.callMain returned (if it returns).");
      return;
    }

    if (!Module._malloc) {
      appendVmLine("Module._malloc not available; cannot build argv for _main.");
      return;
    }

    const argc = args.length + 1;
    const argvBuffer = Module._malloc((argc + 1) * 4);
    let ptrOffset = argvBuffer;

    function writeStringToHeap(s) {
      const buf = Module._malloc(s.length + 1);
      Module.stringToUTF8(s, buf, s.length + 1);
      return buf;
    }

    const progPtr = writeStringToHeap("tinyemu");
    Module.setValue(ptrOffset, progPtr, "i32");
    ptrOffset += 4;

    for (let i = 0; i < args.length; i++) {
      const p = writeStringToHeap(args[i]);
      Module.setValue(ptrOffset, p, "i32");
      ptrOffset += 4;
    }
    Module.setValue(ptrOffset, 0, "i32"); // null terminator

    appendVmLine("Calling _main with argc=" + argc);
    if (typeof Module._main === "function") {
      Module._main(argc, argvBuffer);
      appendVmLine("_main returned (if it returns).");
    } else {
      appendVmLine("Module._main not found; cannot call main.");
    }
  } catch (err) {
    appendVmLine("Error calling main: " + (err && err.message ? err.message : err));
  }

  // Optional framebuffer rendering
  try {
    if (Module._get_framebuffer_ptr && Module._get_framebuffer_width && Module._get_framebuffer_height) {
      const fbPtr = Module._get_framebuffer_ptr();
      const w = Module._get_framebuffer_width();
      const h = Module._get_framebuffer_height();
      appendVmLine("Framebuffer at " + fbPtr + " size " + w + "x" + h);
      function loopRender() {
        try { renderFramebuffer(Module, fbPtr, w, h); } catch (e) {}
        requestAnimationFrame(loopRender);
      }
      loopRender();
    } else {
      appendVmLine("No framebuffer exports detected. If you want graphics, rebuild with framebuffer exports.");
    }
  } catch (err) {
    appendVmLine("Framebuffer check error: " + (err && err.message ? err.message : err));
  }
}

startBtn.addEventListener("click", async () => {
  try {
    await startTinyEmuAndBoot();
  } catch (err) {
    appendVmLine("Failed to start VM: " + (err && err.message ? err.message : err));
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
