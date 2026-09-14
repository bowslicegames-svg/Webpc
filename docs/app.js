// docs/app.js
// TinyEMU loader + Linux boot helper for GitHub Pages
// Minimal edits: use wasm/vmlinux and assemble wasm/parts/disk.raw.part00..part30 into /rootfs/disk.raw

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
  // Hook serial callback if module exposes one (example: Module._serial_write)
  if (typeof Module._serial_write === "function") {
    // optional: wrap or expose to page
  }
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
    // Modularized build
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

    // Classic build
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

/**
 * Assemble /rootfs/disk.raw by concatenating wasm/parts/disk.raw.partXX
 * Tries parts 00..30 and stops when a part is missing (404).
 * Uses Module.FS.writeFile/readFile fallback to avoid low-level FS.write differences.
 */
async function assembleDiskFromParts(Module) {
  appendVmLine("Assembling disk.raw from /wasm/parts/ ...");

  if (!Module || !Module.FS) {
    appendVmLine("Module.FS not available; cannot assemble disk.");
    throw new Error("FS not available");
  }

  try { Module.FS.mkdir("/rootfs"); } catch (e) {}

  // Start with empty file
  try { Module.FS.writeFile("/rootfs/disk.raw", new Uint8Array(0)); } catch (e) {
    appendVmLine("Failed to create /rootfs/disk.raw: " + e.message);
    throw e;
  }

  let total = 0;
  for (let i = 0; i <= 30; i++) {
    const partName = `wasm/parts/disk.raw.part${String(i).padStart(2, "0")}`;
    appendVmLine("Attempting fetch: " + partName);
    let resp;
    try {
      resp = await fetch(partName);
    } catch (e) {
      appendVmLine("Fetch error for " + partName + ": " + e.message);
      break;
    }
    if (!resp.ok) {
      appendVmLine("Part not found (HTTP " + resp.status + "): " + partName);
      break;
    }

    // read whole part
    const ab = await resp.arrayBuffer();
    const chunk = new Uint8Array(ab);
    total += chunk.length;

    // read existing file and append (safe across Emscripten builds)
    try {
      const existing = Module.FS.readFile("/rootfs/disk.raw", { encoding: "binary" });
      const combined = new Uint8Array(existing.length + chunk.length);
      combined.set(existing, 0);
      combined.set(chunk, existing.length);
      Module.FS.writeFile("/rootfs/disk.raw", combined);
    } catch (e) {
      // fallback: try low-level open/write if available
      try {
        const fd = Module.FS.open("/rootfs/disk.raw", "a");
        Module.FS.write(fd, chunk, 0, chunk.length, null);
        Module.FS.close(fd);
      } catch (e2) {
        appendVmLine("Failed to append part " + partName + ": " + (e2.message || e.message));
        throw e2;
      }
    }

    appendVmLine("Appended " + partName + " (" + chunk.length + " bytes)");
  }

  appendVmLine("disk.raw assembled, total size " + total + " bytes");
  return total;
}

async function startTinyEmuAndBoot() {
  vmOutput.textContent = "";
  appendVmLine("Loading tinyemu.js...");
  await loadScript("wasm/tinyemu.js");
  appendVmLine("tinyemu.js loaded.");

  // Fetch wasm manually to avoid MIME streaming issues
  const wasmBinary = await fetchArrayBuffer("wasm/tinyemu.wasm");
  appendVmLine("tinyemu.wasm fetched.");

  const moduleConfig = {
    wasmBinary,
    print: text => appendVmLine(String(text)),
    printErr: text => appendVmLine("ERR: " + String(text)),
    noInitialRun: true
  };

  appendVmLine("Instantiating module...");
  let Module;
  try {
    Module = await initModule(moduleConfig);
  } catch (err) {
    appendVmLine("Module instantiation failed: " + (err.message || err));
    throw err;
  }
  appendVmLine("Module instantiated.");

  installConsoleHooks(Module);

  // Wait briefly for FS to appear
  if (!Module.FS) {
    appendVmLine("Waiting for Module.FS to be available...");
    const start = Date.now();
    while (!Module.FS && Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (!Module.FS) appendVmLine("Module.FS not available after wait.");
  }

  // Fetch kernel (vmlinux)
  let kernelBuf;
  try {
    kernelBuf = await fetchArrayBuffer("wasm/vmlinux");
  } catch (err) {
    appendVmLine("Warning: kernel not found: " + err.message);
    appendVmLine("Upload vmlinux to docs/wasm/ to boot a kernel.");
    return;
  }

  // Write kernel into FS
  try {
    try { Module.FS.mkdir("/boot"); } catch (e) {}
    Module.FS.writeFile("/boot/vmlinux", new Uint8Array(kernelBuf));
    appendVmLine("Wrote /boot/vmlinux");
  } catch (err) {
    appendVmLine("FS write error (kernel): " + err.message);
  }

  // Assemble disk.raw from wasm/parts/disk.raw.part00..part30
  let diskSize = 0;
  try {
    diskSize = await assembleDiskFromParts(Module);
    if (diskSize === 0) {
      appendVmLine("No disk parts found; disk.raw size is 0. Boot may still proceed if kernel doesn't require disk.");
    }
  } catch (err) {
    appendVmLine("Disk assembly failed: " + (err.message || err));
  }

  // Prepare emulator args for disk.raw boot
  const args = [
    "-kernel", "/boot/vmlinux",
    "-drive", "file=/rootfs/disk.raw,format=raw,if=none,id=hd0",
    "-device", "virtio-blk-device,drive=hd0",
    "-append", "console=ttyS0 root=/dev/vda rw",
    "-nographic"
  ];

  appendVmLine("Emulator args: " + args.join(" "));

  // Build argv in Emscripten memory and call main
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
    Module.setValue(ptrOffset, 0, "i32");

    appendVmLine("Calling _main with argc=" + argc);
    if (typeof Module._main === "function") {
      Module._main(argc, argvBuffer);
      appendVmLine("_main returned (if it returns).");
    } else {
      appendVmLine("Module._main not found; cannot call main.");
    }
  } catch (err) {
    appendVmLine("Error calling main: " + (err.message || err));
  }

  // Framebuffer rendering (if exported)
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
    appendVmLine("Framebuffer check error: " + err.message);
  }
}

startBtn.addEventListener("click", async () => {
  try {
    await startTinyEmuAndBoot();
  } catch (err) {
    appendVmLine("Failed to start VM: " + (err.message || err));
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
