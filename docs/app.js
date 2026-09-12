// app.js
// Reassemble disk.raw from parts hosted at /wasm/parts/disk.raw.partNN and boot TinyEMU.
// Writes parts directly into Emscripten FS to minimize memory pressure.
// Expects tinyemu.js and wasm/vmlinux to be present at wasm/.
// If your tinyemu build exposes a different start API, replace the startTinyEmu invocation accordingly.

(() => {
  // Configuration
  const PARTS_BASE = 'wasm/parts/disk.raw.part'; // e.g. wasm/parts/disk.raw.part00
  const PART_PAD = 2; // digits in suffix (00, 01, ...)
  const MAX_MISSING_IN_ROW = 1; // stop when this many consecutive parts are missing
  const WRITE_CHUNK = 4 * 1024 * 1024; // 4MB writes (used when slicing arrays)
  const KERNEL_PATH = 'wasm/vmlinux'; // kernel path inside Emscripten FS or URL depending on tinyemu init

  // UI elements
  const $ = s => document.querySelector(s);
  const startBtn = $('#start-vm');
  const stopBtn = $('#stop-vm');
  const progressBar = $('#progress > i');
  const statusEl = $('#status');
  const logEl = $('#log');
  const canvas = $('#screen');

  function log(...args) {
    const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (logEl) {
      logEl.textContent += text + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    }
    console.log(...args);
  }

  function setStatus(s) { if (statusEl) statusEl.textContent = s; }
  function setProgressFraction(f) { if (progressBar) progressBar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
  function resetProgress() { setProgressFraction(0); }

  // Wait for Emscripten Module to be ready (best-effort)
  function waitForModuleReady(timeoutMs = 15000) {
    return new Promise((resolve) => {
      if (typeof Module !== 'undefined' && (Module.calledRun || Module.onRuntimeInitialized)) {
        resolve(Module);
        return;
      }
      let done = false;
      if (typeof Module !== 'undefined') {
        const prev = Module.onRuntimeInitialized;
        Module.onRuntimeInitialized = function () {
          if (typeof prev === 'function') prev();
          if (!done) { done = true; resolve(Module); }
        };
      }
      // fallback poll
      const start = Date.now();
      const iv = setInterval(() => {
        if (typeof Module !== 'undefined' && (Module.calledRun || Module.onRuntimeInitialized)) {
          clearInterval(iv);
          if (!done) { done = true; resolve(Module); }
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          if (!done) { done = true; resolve(Module); } // resolve anyway; some builds don't set flags
        }
      }, 200);
    });
  }

  // Stream a fetched response body into Module.FS at fd starting at position
  async function streamResponseToFd(resp, fd, startPos, onChunk) {
    const reader = resp.body.getReader();
    let pos = startPos;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // value is Uint8Array
      Module.FS.write(fd, value, 0, value.length, pos);
      pos += value.length;
      if (onChunk) onChunk(value.length);
    }
    return pos;
  }

  // Fetch a single part and write it into the open fd at current position
  async function fetchPartToFd(url, fd, currentPos, onProgress) {
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = new Error('Fetch failed: ' + resp.status);
      err.status = resp.status;
      throw err;
    }
    const newPos = await streamResponseToFd(resp, fd, currentPos, (chunkLen) => {
      if (onProgress) onProgress(chunkLen);
    });
    return newPos;
  }

  // Assemble parts sequentially into /disk/disk.raw
  async function assembleParts() {
    if (typeof Module === 'undefined' || !Module.FS) {
      throw new Error('Emscripten Module.FS not available');
    }

    try { Module.FS.mkdir('/disk'); } catch (e) {}

    // Remove existing file if present
    try { Module.FS.unlink('/disk/disk.raw'); } catch (e) {}

    const fd = Module.FS.open('/disk/disk.raw', 'w+');

    let index = 0;
    let missing = 0;
    let totalBytes = 0;
    setStatus('Assembling disk from parts...');
    resetProgress();
    log('Beginning assembly from parts at', PARTS_BASE);

    while (true) {
      const suffix = String(index).padStart(PART_PAD, '0');
      const url = `${PARTS_BASE}${suffix}`;
      log('Fetching part', url);
      try {
        const prev = totalBytes;
        const newPos = await fetchPartToFd(url, fd, prev, (chunkLen) => {
          totalBytes += chunkLen;
          // heuristic progress: cap to 98% until finished
          const frac = Math.min(0.98, totalBytes / (1024 * 1024 * 1024)); // heuristic scale
          setProgressFraction(frac);
        });
        log(`Wrote part ${suffix}, bytes so far: ${newPos}`);
        index += 1;
        missing = 0;
      } catch (err) {
        if (err && err.status === 404) {
          log('Part not found (404):', url);
          missing += 1;
          if (missing >= MAX_MISSING_IN_ROW) {
            log('No more parts found; finishing assembly.');
            break;
          } else {
            index += 1;
            continue;
          }
        } else {
          Module.FS.close(fd);
          throw err;
        }
      }
    }

    Module.FS.close(fd);
    setProgressFraction(1);
    setStatus('Assembly complete: ' + totalBytes + ' bytes');
    log('Assembly complete, total bytes:', totalBytes);
    return '/disk/disk.raw';
  }

  // TinyEMU boot helper: adapt to your tinyemu.js API if needed
  function bootTinyEmuWithDisk(diskPath) {
    setStatus('Booting TinyEMU...');
    log('Booting TinyEMU with disk:', diskPath);

    // If your project exposes a startTinyEmu function, prefer it
    if (typeof startTinyEmu === 'function') {
      try {
        startTinyEmu({
          kernelUrl: KERNEL_PATH,
          diskPath: diskPath,
          canvas: canvas,
        });
        return;
      } catch (e) {
        log('startTinyEmu threw:', e);
      }
    }

    // If Module.start exists (some builds), try that
    if (typeof Module !== 'undefined' && typeof Module.start === 'function') {
      try {
        Module.start({ kernel: KERNEL_PATH, disk: diskPath, canvas: canvas });
        return;
      } catch (e) {
        log('Module.start threw:', e);
      }
    }

    // If TinyEMU exposes a global TinyEmu class or function, attempt a common pattern
    if (typeof TinyEmu === 'function') {
      try {
        // Example: new TinyEmu({canvas, kernel:..., disk:...})
        new TinyEmu({ canvas, kernel: KERNEL_PATH, disk: diskPath });
        return;
      } catch (e) {
        log('TinyEmu constructor threw:', e);
      }
    }

    // Last resort: inform user to adapt this function
    log('No known TinyEMU start API found. Please adapt bootTinyEmuWithDisk() to call your tinyemu init.');
    setStatus('Disk prepared. Adapt app.js to start TinyEMU.');
  }

  // Start VM handler
  async function onStart() {
    startBtn.disabled = true;
    setStatus('Preparing disk image...');
    resetProgress();
    log('Start VM clicked');

    try {
      await waitForModuleReady().catch(() => {
        log('Module readiness timed out or not signaled; continuing anyway.');
      });

      const diskPath = await assembleParts();

      // Small delay to ensure FS is stable on some browsers
      await new Promise(r => setTimeout(r, 200));

      bootTinyEmuWithDisk(diskPath);

      stopBtn.disabled = false;
      setStatus('VM running (or disk prepared)');
    } catch (err) {
      log('Error:', err && err.message ? err.message : err);
      setStatus('Error: ' + (err && err.message ? err.message : String(err)));
      startBtn.disabled = false;
      resetProgress();
    }
  }

  // Stop VM handler (best-effort)
  function onStop() {
    log('Stop VM clicked');
    if (typeof stopTinyEmu === 'function') {
      try { stopTinyEmu(); } catch (e) { log('stopTinyEmu threw:', e); }
    } else if (typeof Module !== 'undefined' && typeof Module.stop === 'function') {
      try { Module.stop(); } catch (e) { log('Module.stop threw:', e); }
    } else {
      log('No stop API found; reload the page to fully stop the VM.');
    }
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus('Stopped');
    resetProgress();
  }

  // Attach handlers
  if (startBtn) startBtn.addEventListener('click', onStart);
  if (stopBtn) stopBtn.addEventListener('click', onStop);

  log('app.js loaded. Click Start VM to assemble disk parts and boot TinyEMU.');
})();
