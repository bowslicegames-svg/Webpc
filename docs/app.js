// docs/app.js
// TinyEMU loader + Linux boot helper for GitHub Pages
// Regenerated: only the disk assembly behavior changed to yield after every 5 parts.
// Parts are expected at /wasm/parts/disk.raw.part00 .. part30
// index.html is in /docs and wasm files are in /docs/wasm/

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
  Disk assembler (modified to yield after every 5 parts)
  - Streams each part from /wasm/parts/disk.raw.partXX
  - Writes in moderate sub-chunks to avoid huge allocations
  - Persists to IDBFS periodically if available
  - Yields (await) after every 5 parts to let the browser breathe
*/
async function assembleDiskFromParts(Module, opts) {
  opts = opts || {};
  const maxPartIndex = typeof opts.maxPartIndex === "number" ? opts.maxPartIndex : 30;
  const partPrefix = opts.partPrefix || "wasm/parts/disk.raw.part";
  const pad = typeof opts.pad === "number" ? opts.pad : 2;
  const chunkWriteSize = typeof opts.chunkWriteSize === "number" ? opts.chunkWriteSize : 64 * 1024; // 64 KiB
  const syncEveryParts = typeof opts.syncEveryParts === "number" ? opts.syncEveryParts : 2;
  const yieldAfterParts = typeof opts.yieldAfterParts === "number" ? opts.yieldAfterParts : 5;
  const rootPath = opts.rootPath || "/rootfs";
  const targetFile = opts.targetFile || "/rootfs/disk.raw";

  appendVmLine("Assembling disk.raw from /wasm/parts/ ...");

  if (!Module || !Module.FS) {
    appendVmLine("Module.FS not available; cannot assemble disk.");
    throw new Error("FS not available");
  }

  // Ensure root path exists and attempt to mount IDBFS for persistence
  try {
    try { Module.FS.mkdir(rootPath); } catch (e) {}
    try {
      Module.FS.mount(Module.IDBFS, {}, rootPath);
      appendVmLine("Mounted IDBFS at " + rootPath);
    } catch (e) {
      appendVmLine("IDBFS mount failed (continuing in-memory): " + (e && e.message ? e.message : e));
    }
  } catch (e) {
    appendVmLine("FS setup error: " + (e && e.message ? e.message : e));
  }

  // Helpers to sync IDBFS
  function syncFromIdb() {
    return new Promise(resolve => {
      if (!Module.FS || !Module.FS.syncfs) return resolve();
      Module.FS.syncfs(true, function (err) {
        if (err) appendVmLine("IDBFS sync (load) error: " + err);
        resolve();
      });
    });
  }
  function syncToIdb() {
    return new Promise(resolve => {
      if (!Module.FS || !Module.FS.syncfs) return resolve();
      Module.FS.syncfs(false, function (err) {
        if (err) appendVmLine("IDBFS sync (save) error: " + err);
        resolve();
      });
    });
  }

  await syncFromIdb();

  // Determine resume offset
  let existingSize = 0;
  try {
    const stat = Module.FS.stat(targetFile);
    existingSize = stat.size || 0;
    appendVmLine("Resuming: existing disk.raw size " + existingSize + " bytes");
  } catch (e) {
    appendVmLine("No existing disk.raw, starting fresh");
    try { Module.FS.writeFile(targetFile, new Uint8Array(0)); } catch (e2) {}
    existingSize = 0;
  }

  // Open file descriptor for append
  let fd;
  try {
    fd = Module.FS.open(targetFile, "r+");
  } catch (e) {
    try {
      fd = Module.FS.open(targetFile, "w+");
    } catch (e2) {
      appendVmLine("Failed to open target file: " + (e2 && e2.message ? e2.message : e2));
      throw e2;
    }
  }

  let pos = existingSize;
  let total = existingSize;
  let partsWritten = 0;

  for (let i = 0; i <= maxPartIndex; i++) {
    const partName = partPrefix + String(i).padStart(pad, "0");
    appendVmLine("Attempting fetch: " + partName);

    let resp;
    try {
      resp = await fetch(partName, { cache: "no-store" });
    } catch (e) {
      appendVmLine("Fetch error for " + partName + ": " + (e && e.message ? e.message : e));
      break;
    }
    if (!resp.ok) {
      appendVmLine("Part not found (HTTP " + resp.status + "): " + partName);
      break;
    }

    // Stream the part and write in sub-chunks
    const reader = resp.body && resp.body.getReader ? resp.body.getReader() : null;

    if (!reader) {
      // fallback: read whole arrayBuffer but write in sub-chunks
      const ab = await resp.arrayBuffer();
      const view = new Uint8Array(ab);
      let offset = 0;
      while (offset < view.length) {
        const end = Math.min(offset + chunkWriteSize, view.length);
        const slice = view.subarray(offset, end);
        Module.FS.write(fd, slice, 0, slice.length, pos);
        pos += slice.length;
        total += slice.length;
        offset = end;
      }
    } else {
      // streaming path: read and write in sub-chunks
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
        let off = 0;
        while (off < chunk.length) {
          const len = Math.min(chunkWriteSize, chunk.length - off);
          const sub = chunk.subarray(off, off + len);
          Module.FS.write(fd, sub, 0, sub.length, pos);
          pos += sub.length;
          total += sub.length;
          off += len;
        }
      }
    }

    partsWritten++;
    appendVmLine("Appended " + partName + " (total " + total + " bytes)");

    // Periodically persist to IndexedDB to reduce memory pressure and survive reloads
    if (partsWritten % syncEveryParts === 0) {
      appendVmLine("Syncing to IDBFS (persisting)...");
      await syncToIdb();
      appendVmLine("Sync complete.");
    }

    // Yield after every N parts (user requested N=5 by default)
    if (partsWritten % yieldAfterParts === 0) {
      appendVmLine("Yielding to browser after " + partsWritten + " parts...");
      // small pause to let the browser handle UI/GC and avoid watchdog
      await new Promise(r => setTimeout(r, 0));
    }
  }

  try { Module.FS.close(fd); } catch (e) {}
  // Final sync
  await syncToIdb();

  appendVmLine("disk.raw assembled, final size " + total + " bytes");
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

  // Provide print hooks so module output goes to the page
  const moduleConfig = {
    wasmBinary,
    print: text => appendVmLine(String(text)),
    printErr: text => appendVmLine("ERR: " + String(text)),
    noInitialRun: true
  };

  appendVmLine("Instantiating TinyEmuModule...");
  const Module = await initModule(moduleConfig);
  appendVmLine("TinyEmuModule instantiated.");

  installConsoleHooks(Module);

  // Wait for FS to be available
  if (!Module.FS) {
    appendVmLine("Waiting for Module.FS to be available...");
    const start = Date.now();
    while (!Module.FS && Date.now() - start < 5000) {
      await new Promise(r => setTimeout(r, 50));
    }
    if (!Module.FS) {
      appendVmLine("Module.FS not available after wait.");
      // Continue anyway; later operations will fail with clearer messages
    }
  }

  // Fetch kernel (vmlinux)
  let kernelBuf;
  try {
    kernelBuf = await fetchArrayBuffer("wasm/vmlinux");
  } catch (err) {
    appendVmLine("Warning: kernel not found: " + (err && err.message ? err.message : err));
    appendVmLine("Upload vmlinux to docs/wasm/ to boot a kernel.");
    return;
  }

  // Write kernel into FS
  try {
    try { Module.FS.mkdir("/boot"); } catch (e) {}
    Module.FS.writeFile("/boot/vmlinux", new Uint8Array(kernelBuf));
    appendVmLine("Wrote /boot/vmlinux");
  } catch (err) {
    appendVmLine("FS write error (kernel): " + (err && err.message ? err.message : err));
  }

  // Assemble disk.raw from wasm/parts/disk.raw.part00..part30 using the assembler above
  let diskSize = 0;
  try {
    diskSize = await assembleDiskFromParts(Module, {
      maxPartIndex: 30,
      partPrefix: "wasm/parts/disk.raw.part",
      pad: 2,
      chunkWriteSize: 64 * 1024,
      syncEveryParts: 2,
      yieldAfterParts: 5,
      rootPath: "/rootfs",
      targetFile: "/rootfs/disk.raw"
    });
    if (diskSize === 0) {
      appendVmLine("No disk parts found; disk.raw size is 0. Boot may fail if disk is required.");
    }
  } catch (err) {
    appendVmLine("Disk assembly failed: " + (err && err.message ? err.message : err));
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

    // program name
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

  // Framebuffer rendering (if exported)
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
