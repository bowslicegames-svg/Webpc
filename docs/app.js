// docs/app.js
// Reassemble disk.raw from parts hosted at /wasm/parts/disk.raw.partNN
// Streams each part into Emscripten FS to avoid large in-memory buffers.
// After assembly, calls startTinyEmu({ kernelUrl: 'wasm/vmlinux', diskPath: '/disk/disk.raw' }).
// Replace startTinyEmu call if your tinyemu build uses a different API.

(() => {
  const PARTS_BASE = 'wasm/parts/disk.raw.part'; // final URL will be e.g. wasm/parts/disk.raw.part00
  const PART_PAD = 2; // number of digits in suffix (00, 01, ...)
  const MAX_MISSING_IN_ROW = 1; // stop when a part is missing (404)
  const CHUNK_WRITE = 4 * 1024 * 1024; // 4MB writes to FS

  const $ = sel => document.querySelector(sel);
  const startBtn = $('#start-vm');
  const stopBtn = $('#stop-vm');
  const progressBar = $('#progress > i');
  const statusEl = $('#status');
  const logEl = $('#log');

  function log(...args) {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (logEl) { logEl.textContent += s + '\n'; logEl.scrollTop = logEl.scrollHeight; }
    console.log(...args);
  }
  function setStatus(s) { if (statusEl) statusEl.textContent = s; }
  function setProgressFraction(f) { if (progressBar) progressBar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
  function resetProgress() { setProgressFraction(0); }

  // Helper to fetch a part URL and stream-write into Module.FS file descriptor
  async function streamWritePartToFd(url, fd, startPosition, onProgressChunk) {
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = new Error('Fetch failed: ' + resp.status);
      err.status = resp.status;
      throw err;
    }
    const reader = resp.body.getReader();
    let pos = startPosition;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // value is a Uint8Array
      Module.FS.write(fd, value, 0, value.length, pos);
      pos += value.length;
      if (onProgressChunk) onProgressChunk(value.length);
    }
    return pos; // new position after writing
  }

  // Assemble parts sequentially until a 404 is encountered
  async function assemblePartsToDisk() {
    if (typeof Module === 'undefined' || !Module.FS) {
      throw new Error('Emscripten Module.FS not available');
    }

    // Ensure /disk exists
    try { Module.FS.mkdir('/disk'); } catch (e) {}

    // Remove any existing file and open for writing
    try { Module.FS.unlink('/disk/disk.raw'); } catch (e) {}
    const fd = Module.FS.open('/disk/disk.raw', 'w+');

    let partIndex = 0;
    let missingCount = 0;
    let totalBytes = 0;
    let reportedBytes = 0;

    setStatus('Assembling disk from parts...');
    resetProgress();
    log('Starting assembly from parts at', PARTS_BASE);

    // First pass: attempt to fetch parts sequentially until 404
    while (true) {
      const suffix = String(partIndex).padStart(PART_PAD, '0');
      const url = `${PARTS_BASE}${suffix}`;
      log('Fetching part', url);
      try {
        // stream the part directly into the open fd at current position
        const prevPos = totalBytes;
        const newPos = await streamWritePartToFd(url, fd, prevPos, (chunkLen) => {
          totalBytes += chunkLen;
          // update progress heuristically (we don't know final size)
          const frac = Math.min(0.98, totalBytes / (1024 * 1024 * 1024)); // heuristic cap
          setProgressFraction(frac);
        });
        // newPos equals prevPos + bytes written
        reportedBytes = totalBytes;
        log(`Wrote part ${suffix}, bytes written so far: ${reportedBytes}`);
        partIndex += 1;
        missingCount = 0; // reset missing counter
      } catch (err) {
        if (err && err.status === 404) {
          log('Part not found (404):', url);
          missingCount += 1;
          if (missingCount >= MAX_MISSING_IN_ROW) {
            log('No more parts found; finishing assembly.');
            break;
          } else {
            // skip a single missing part and continue (rare)
            partIndex += 1;
            continue;
          }
        } else {
          // other error: rethrow
          Module.FS.close(fd);
          throw err;
        }
      }
    }

    Module.FS.close(fd);
    setProgressFraction(1);
    setStatus('Assembly complete: ' + reportedBytes + ' bytes');
    log('Assembly complete, total bytes:', reportedBytes);
    return '/disk/disk.raw';
  }

  // Start VM handler
  async function onStartVm() {
    startBtn.disabled = true;
    setStatus('Preparing disk image...');
    resetProgress();
    log('Start VM pressed');

    try {
      // Wait briefly for Module to be ready if present
      if (typeof Module !== 'undefined' && Module.onRuntimeInitialized) {
        // If Module hasn't initialized yet, wait up to 10s
        await new Promise((resolve) => {
          let done = false;
          const prev = Module.onRuntimeInitialized;
          Module.onRuntimeInitialized = function () {
            if (typeof prev === 'function') prev();
            if (!done) { done = true; resolve(); }
          };
          setTimeout(() => { if (!done) { done = true; resolve(); } }, 10000);
        });
      }

      // Assemble parts into /disk/disk.raw
      const diskPath = await assemblePartsToDisk();

      setStatus('Disk ready, starting TinyEMU...');
      log('Disk assembled at', diskPath);

      // Start TinyEMU. Replace this with your tinyemu init if different.
      if (typeof startTinyEmu === 'function') {
        startTinyEmu({ kernelUrl: 'wasm/vmlinux', diskPath });
      } else if (typeof Module !== 'undefined' && Module.start) {
        Module.start({ kernel: 'wasm/vmlinux', disk: diskPath });
      } else {
        log('No TinyEMU start function found. Disk prepared at', diskPath);
        setStatus('Disk prepared. Adapt app.js to start TinyEMU.');
      }

      stopBtn.disabled = false;
      setStatus('VM running (or disk prepared)');
    } catch (err) {
      log('Error during assembly or start:', err && err.message ? err.message : err);
      setStatus('Error: ' + (err && err.message ? err.message : String(err)));
      startBtn.disabled = false;
      resetProgress();
    }
  }

  function onStopVm() {
    log('Stop VM pressed');
    if (typeof stopTinyEmu === 'function') stopTinyEmu();
    else if (typeof Module !== 'undefined' && Module.stop) Module.stop();
    else log('No stop function found; reload to stop.');
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus('Stopped');
    resetProgress();
  }

  if (startBtn) startBtn.addEventListener('click', onStartVm);
  if (stopBtn) stopBtn.addEventListener('click', onStopVm);

  log('app.js loaded. Click Start VM to assemble disk from parts and boot TinyEMU.');
})();
