// docs/app.js
// TinyEMU loader + Linux boot helper for GitHub Pages
// Restored to the last working version + tiny safe yield after each part.
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
  Disk assembler — restored to the last working version
  - Streams each part
  - Writes in 64 KiB chunks
  - Micro-yield (1ms) inside chunk loop
  - Yield every 5 parts (0ms)
  - NEW: tiny safe yield (3ms) after each part
*/
async function assembleDiskFromParts(Module) {
  appendVmLine("Assembling disk.raw from /wasm/parts/...");

  if (!Module || !Module.FS) {
    appendVmLine("Module.FS not available; cannot assemble disk.");
    throw new Error("FS not available");
  }

  try { Module.FS.mkdir("/rootfs"); } catch (e) {}

  let fd;
  try {
    Module.FS.writeFile("/rootfs/disk.raw", new Uint8Array(0));
    fd = Module.FS.open("/rootfs/disk.raw", "r+");
  } catch (e) {
    appendVmLine("Failed to open /rootfs/disk.raw: " + e.message);
    throw e;
  }

  let pos = 0;
  let partsWritten = 0;

  const microYield = () => new Promise(r => setTimeout(r, 1));
  const tinyYield = () => new Promise(r => setTimeout(r, 3));

  for (let i = 0; i <= 30; i++) {
    const partName = `wasm/parts/disk.raw.part${String(i).padStart(2, "0")}`;
    appendVmLine("Fetching " + partName);

    const resp = await fetch(partName, { cache: "no-store" });
    if (!resp.ok) {
      appendVmLine("No more parts (HTTP " + resp.status + ")");
      break;
    }

    const reader = resp.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let offset = 0;
      const CHUNK = 64 * 1024;

      while (offset < value.length) {
        const slice = value.subarray(offset, offset + CHUNK);
        Module.FS.write(fd, slice, 0, slice.length, pos);
        pos += slice.length;
        offset += CHUNK;

        await microYield();
      }
    }

    partsWritten++;
    appendVmLine(`Appended part ${i}, total bytes: ${pos}`);

    if (partsWritten % 5 === 0) {
      await microYield(); // same behavior as before
    }

    await tinyYield(); // NEW: prevents crash at part 13–14
  }

  Module.FS.close(fd);
  appendVmLine("disk.raw assembled, final size " + pos + " bytes");

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

  let kernelBuf;
  try {
    kernelBuf = await fetchArrayBuffer("wasm/vmlinux");
  } catch (err) {
    appendVmLine("Kernel missing: " + err.message);
    return;
  }

  try {
    try { Module.FS.mkdir("/boot"); } catch (e) {}
    Module.FS.writeFile("/boot/vmlinux", new Uint8Array(kernelBuf));
    appendVmLine("Wrote /boot/vmlinux");
  } catch (err) {
    appendVmLine("FS write error (kernel): " + err.message);
  }

  let diskSize = 0;
  try {
    diskSize = await assembleDiskFromParts(Module);
  } catch (err) {
    appendVmLine("Disk assembly failed: " + err.message);
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
      Module.callMain(["tinyemu", ...args]);
      return;
    }

    if (!Module._malloc) {
      appendVmLine("Module._malloc missing.");
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
    Module.setValue(ptrOffset, 0, "i32");

    if (typeof Module._main === "function") {
      Module._main(argc, argvBuffer);
    }
  } catch (err) {
    appendVmLine("Error calling main: " + err.message);
  }

  try {
    if (Module._get_framebuffer_ptr) {
      const fbPtr = Module._get_framebuffer_ptr();
      const w = Module._get_framebuffer_width();
      const h = Module._get_framebuffer_height();
      function loopRender() {
        try { renderFramebuffer(Module, fbPtr, w, h); } catch (e) {}
        requestAnimationFrame(loopRender);
      }
      loopRender();
    }
  } catch (err) {
    appendVmLine("Framebuffer error: " + err.message);
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
