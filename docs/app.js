// docs/app.js
// TinyEMU loader + Linux boot helper for GitHub Pages
// Pure in‑memory FS + safe chunked disk.raw upload

const vmOutput = document.getElementById("vm-output");
const startBtn = document.getElementById("start-vm");
const renderBtn = document.getElementById("render");
const canvas = document.getElementById("screen");
const diskUploadInput = document.getElementById("disk-upload");

function appendVmLine(line) {
  vmOutput.textContent += line + "\n";
  vmOutput.scrollTop = vmOutput.scrollHeight;
}

window.addEventListener("error", e => appendVmLine("Global error: " + e.message));
window.addEventListener("unhandledrejection", e => appendVmLine("Unhandled rejection: " + e.reason));

async function loadScript(path) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = path;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load script: " + path));
    document.head.appendChild(s);
  });
}

async function fetchArrayBuffer(path) {
  appendVmLine("Fetching " + path);
  const resp = await fetch(path, { cache: "no-store" });
  appendVmLine("HTTP " + resp.status + " " + resp.statusText);
  if (!resp.ok) throw new Error("Failed to fetch " + path);
  const ab = await resp.arrayBuffer();
  appendVmLine("Fetched bytes: " + ab.byteLength);
  return ab;
}

function installConsoleHooks(Module) {
  if (!Module) return;
  Module.print = text => appendVmLine(String(text));
  Module.printErr = text => appendVmLine("ERR: " + String(text));
}

function renderFramebuffer(Module, fbPtr, width, height) {
  const ctx = canvas.getContext("2d");
  canvas.width = width;
  canvas.height = height;
  const image = ctx.createImageData(width, height);
  const fbBytes = new Uint8Array(Module.HEAPU8.buffer, fbPtr, width * height * 4);
  image.data.set(fbBytes);
  ctx.putImageData(image, 0, 0);
}

function initModule(config) {
  return new Promise((resolve, reject) => {
    if (typeof window.TinyEmuModule === "function") {
      const result = window.TinyEmuModule(config);
      if (result && result.then) result.then(resolve).catch(reject);
      else resolve(result);
      return;
    }

    const merged = Object.assign({}, window.Module || {}, config);
    window.Module = merged;

    const prev = window.Module.onRuntimeInitialized;
    window.Module.onRuntimeInitialized = () => {
      if (typeof prev === "function") prev();
      resolve(window.Module);
    };
  });
}

/***************
 SAFE UPLOAD DISK
***************/
async function writeUploadedDisk(Module, file) {
  appendVmLine("Writing uploaded disk.raw in safe chunks...");

  try { Module.FS.mkdir("/rootfs"); } catch (e) {}

  const ab = await file.arrayBuffer();
  const u8 = new Uint8Array(ab);

  Module.FS.writeFile("/rootfs/disk.raw", new Uint8Array(0));
  const fd = Module.FS.open("/rootfs/disk.raw", "r+");

  let pos = 0;
  const CHUNK = 64 * 1024;
  const microYield = () => new Promise(r => setTimeout(r, 1));

  while (pos < u8.length) {
    const end = Math.min(pos + CHUNK, u8.length);
    const slice = u8.subarray(pos, end);
    Module.FS.write(fd, slice, 0, slice.length, pos);
    pos = end;
    await microYield();
  }

  Module.FS.close(fd);
  appendVmLine("Uploaded disk.raw written (" + u8.length + " bytes)");
  return u8.length;
}

/***************
 FALLBACK: PARTS
***************/
async function assembleDiskFromParts(Module) {
  appendVmLine("Assembling disk.raw from parts (fallback)");

  try { Module.FS.mkdir("/rootfs"); } catch (e) {}
  Module.FS.writeFile("/rootfs/disk.raw", new Uint8Array(0));
  const fd = Module.FS.open("/rootfs/disk.raw", "r+");

  let pos = 0;
  const CHUNK = 64 * 1024;
  const microYield = () => new Promise(r => setTimeout(r, 1));

  for (let i = 0; i <= 30; i++) {
    const partName = `wasm/parts/disk.raw.part${String(i).padStart(2, "0")}`;
    appendVmLine("Fetching " + partName);

    const resp = await fetch(partName, { cache: "no-store" });
    if (!resp.ok) break;

    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let offset = 0;
      while (offset < value.length) {
        const end = Math.min(offset + CHUNK, value.length);
        const slice = value.subarray(offset, end);
        Module.FS.write(fd, slice, 0, slice.length, pos);
        pos += slice.length;
        offset = end;
        await microYield();
      }
    }

    appendVmLine(`Appended part ${i}, total ${pos}`);
  }

  Module.FS.close(fd);
  appendVmLine("disk.raw assembled, final size " + pos);
  return pos;
}

/***************
 START VM
***************/
async function startTinyEmuAndBoot() {
  vmOutput.textContent = "";
  appendVmLine("Loading tinyemu.js...");
  await loadScript("wasm/tinyemu.js");

  const wasmBinary = await fetchArrayBuffer("wasm/tinyemu.wasm");
  const Module = await initModule({
    wasmBinary,
    print: text => appendVmLine(String(text)),
    printErr: text => appendVmLine("ERR: " + String(text)),
    noInitialRun: true
  });

  installConsoleHooks(Module);

  const kernelBuf = await fetchArrayBuffer("wasm/vmlinux");
  try { Module.FS.mkdir("/boot"); } catch (e) {}
  Module.FS.writeFile("/boot/vmlinux", new Uint8Array(kernelBuf));

  let diskSize = 0;
  const file = diskUploadInput.files[0];

  if (file) {
    appendVmLine("User provided disk.raw — using uploaded file.");
    diskSize = await writeUploadedDisk(Module, file);
  } else {
    appendVmLine("No uploaded disk — assembling from parts.");
    diskSize = await assembleDiskFromParts(Module);
  }

  const args = [
    "-kernel", "/boot/vmlinux",
    "-drive", "file=/rootfs/disk.raw,format=raw,if=none,id=hd0",
    "-device", "virtio-blk-device,drive=hd0",
    "-append", "console=ttyS0 root=/dev/vda rw",
    "-nographic"
  ];

  if (Module.callMain) {
    Module.callMain(["tinyemu", ...args]);
  } else {
    appendVmLine("Module.callMain missing.");
  }
}

startBtn.addEventListener("click", () => startTinyEmuAndBoot());
renderBtn.addEventListener("click", () => {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f0";
  ctx.font = "16px monospace";
  ctx.fillText("Renderer: placeholder frame", 10, 30);
});
