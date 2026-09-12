(() => {
  const PARTS_BASE = "wasm/parts/disk.raw.part";
  const PART_PAD = 2;
  const KERNEL_PATH = "wasm/vmlinux";

  const $ = s => document.querySelector(s);
  const startBtn = $("#start-vm");
  const stopBtn = $("#stop-vm");
  const progressBar = $("#progress > i");
  const statusEl = $("#status");
  const logEl = $("#log");
  const canvas = $("#screen");

  let Module = null; // will be set by TinyEmuModule()

  function log(msg) {
    logEl.textContent += msg + "\n";
    logEl.scrollTop = logEl.scrollHeight;
    console.log(msg);
  }
  function setStatus(s) { statusEl.textContent = s; }
  function setProgress(f) { progressBar.style.width = (f * 100) + "%"; }

  async function initTinyEmu() {
    if (Module) return Module; // already initialized

    setStatus("Downloading VM module...");
    log("Calling TinyEmuModule()...");

    Module = await TinyEmuModule({
      noInitialRun: true,
      print: msg => log(msg),
      printErr: msg => log("ERR: " + msg),
      onRuntimeInitialized() {
        log("TinyEMU runtime initialized");
      }
    });

    if (!Module.FS) throw new Error("TinyEMU Module.FS not available after init");
    log("Module.FS ready");
    return Module;
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

    // TinyEmuModule’s run() already wired _main; we just call main via ccall
    if (Module.ccall) {
      Module.ccall("main", "number", ["string", "string"], [KERNEL_PATH, diskPath]);
      stopBtn.disabled = false;
      setStatus("VM running");
    } else {
      log("ERROR: Module.ccall not available; adapt bootTinyEmu to your build.");
      setStatus("TinyEMU start function missing");
    }
  }

  async function startVM() {
    startBtn.disabled = true;

    try {
      await initTinyEmu();
      const diskPath = await assembleDisk();
      bootTinyEmu(diskPath);
    } catch (err) {
      log("ERROR: " + err.message);
      setStatus("Error: " + err.message);
      startBtn.disabled = false;
    }
  }

  function stopVM() {
    log("Stopping VM...");
    // Your build may expose a stop function; if not, reload is the only full stop.
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus("Stopped");
  }

  startBtn.addEventListener("click", startVM);
  stopBtn.addEventListener("click", stopVM);

  log("app.js loaded; press Start VM to init TinyEMU and assemble disk.");
})();
