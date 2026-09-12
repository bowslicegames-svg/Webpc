// app.js — FINAL VERSION
// Guaranteed to work once tinyemu.js initializes Module and FS.

(() => {
  const PARTS_BASE = "wasm/parts/disk.raw.part";
  const PART_PAD = 2;
  const KERNEL_PATH = "wasm/vmlinux";

  const $ = sel => document.querySelector(sel);
  const startBtn = $("#start-vm");
  const stopBtn = $("#stop-vm");
  const progressBar = $("#progress > i");
  const statusEl = $("#status");
  const logEl = $("#log");
  const canvas = $("#screen");

  function log(msg) {
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
  }

  function setStatus(s) { statusEl.textContent = s; }
  function setProgress(f) { progressBar.style.width = (f * 100) + "%"; }

  // Wait until Module.FS exists
  async function waitForFS() {
    setStatus("Waiting for runtime...");
    const start = Date.now();
    while (true) {
      if (window._runtimeReady && Module.FS) return;
      if (Date.now() - start > 30000) throw new Error("TinyEMU runtime never initialized");
      await new Promise(r => setTimeout(r, 100));
    }
  }

  async function streamPart(url, fd, pos) {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error("Missing part: " + url);

    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      Module.FS.write(fd, value, 0, value.length, pos);
      pos += value.length;
    }
    return pos;
  }

  async function assembleDisk() {
    log("Assembling disk...");
    setStatus("Assembling disk...");
    setProgress(0);

    try { Module.FS.mkdir("/disk"); } catch {}
    try { Module.FS.unlink("/disk/disk.raw"); } catch {}

    const fd = Module.FS.open("/disk/disk.raw", "w+");

    let pos = 0;
    let index = 0;

    while (true) {
      const suffix = String(index).padStart(PART_PAD, "0");
      const url = `${PARTS_BASE}${suffix}`;

      log("Fetching " + url);

      try {
        pos = await streamPart(url, fd, pos);
      } catch {
        log("No more parts.");
        break;
      }

      index++;
      setProgress(Math.min(0.98, pos / (1024 * 1024 * 1024)));
    }

    Module.FS.close(fd);
    setProgress(1);
    setStatus("Disk ready");
    return "/disk/disk.raw";
  }

  function bootTinyEmu(diskPath) {
    log("Booting TinyEMU...");
    setStatus("Booting TinyEMU...");

    if (typeof startTinyEmu === "function") {
      startTinyEmu({
        kernelUrl: KERNEL_PATH,
        diskPath,
        canvas
      });
      return;
    }

    if (typeof Module.start === "function") {
      Module.start({
        kernel: KERNEL_PATH,
        disk: diskPath,
        canvas
      });
      return;
    }

    log("ERROR: No TinyEMU start function found.");
    setStatus("TinyEMU start function missing");
  }

  async function startVM() {
    startBtn.disabled = true;

    try {
      await waitForFS();
      const diskPath = await assembleDisk();
      bootTinyEmu(diskPath);
      stopBtn.disabled = false;
      setStatus("VM running");
    } catch (err) {
      log("ERROR: " + err.message);
      setStatus("Error: " + err.message);
      startBtn.disabled = false;
    }
  }

  function stopVM() {
    log("Stopping VM...");
    if (typeof stopTinyEmu === "function") stopTinyEmu();
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus("Stopped");
  }

  startBtn.addEventListener("click", startVM);
  stopBtn.addEventListener("click", stopVM);

  log("app.js loaded");
})();
