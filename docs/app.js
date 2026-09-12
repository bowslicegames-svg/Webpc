// app.js
// Robust loader that waits for Emscripten Module.FS to be available before assembling disk parts
// and starting TinyEMU. Works on iPad and other browsers where Module initializes asynchronously.

(() => {
  // Configuration
  const PARTS_BASE = 'wasm/parts/disk.raw.part'; // e.g. wasm/parts/disk.raw.part00
  const PART_PAD = 2; // digits in suffix (00, 01, ...)
  const MAX_MISSING_IN_ROW = 1; // stop when this many consecutive parts are missing
  const KERNEL_PATH = 'wasm/vmlinux'; // kernel path used by tinyemu init
  const CANVAS_ID = 'screen';

  // UI
  const $ = s => document.querySelector(s);
  const startBtn = $('#start-vm');
  const stopBtn = $('#stop-vm');
  const progressBar = $('#progress > i');
  const statusEl = $('#status');
  const logEl = $('#log');
  const canvas = document.getElementById(CANVAS_ID);

  function log(...args) {
    const text = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (logEl) { logEl.textContent += text + '\n'; logEl.scrollTop = logEl.scrollHeight; }
    console.log(...args);
  }
  function setStatus(s) { if (statusEl) statusEl.textContent = s; }
  function setProgressFraction(f) { if (progressBar) progressBar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
  function resetProgress() { setProgressFraction(0); }

  // Wait until Module.FS exists and is usable. Returns Module when ready.
  function waitForModuleFS(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const start = Date.now();

      function check() {
        if (typeof Module !== 'undefined' && Module.FS && typeof Module.FS.write === 'function') {
          resolve(Module);
          return true;
        }
        return false;
      }

      if (check()) return;

      // If tinyemu.js sets onRuntimeInitialized, hook it
      try {
        if (typeof Module !== 'undefined') {
          const prev = Module.onRuntimeInitialized;
          Module.onRuntimeInitialized = function () {
            if (typeof prev === 'function') prev();
            if (check()) return;
          };
        }
      } catch (e) {
        // ignore
      }

      const iv = setInterval(() => {
        if (check()) {
          clearInterval(iv);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          // final attempt: resolve anyway but caller must check FS
          reject(new Error('Emscripten Module.FS did not become available within timeout'));
        }
      }, 200);
    });
  }

  // Stream response body into Module.FS at fd starting at startPos
  async function streamResponseToFd(resp, fd, startPos, onChunk) {
    const reader = resp.body.getReader();
    let pos = startPos;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      Module.FS.write(fd, value, 0, value.length, pos);
      pos += value.length;
      if (onChunk) onChunk(value.length);
    }
    return pos;
  }

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
  async function assemblePartsToDisk() {
    if (typeof Module === 'undefined' || !Module.FS) {
      throw new Error('Emscripten Module.FS not available');
    }

    try { Module.FS.mkdir('/disk'); } catch (e) {}

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

  // Boot TinyEMU with the assembled disk. Adapt this to your tinyemu API if needed.
  function bootTinyEmu(diskPath) {
    setStatus('Booting TinyEMU...');
    log('Booting TinyEMU with disk:', diskPath);

    // Common patterns: startTinyEmu, Module.start, TinyEmu constructor
    if (typeof startTinyEmu === 'function') {
      try {
        startTinyEmu({ kernelUrl: KERNEL_PATH, diskPath, canvas });
        return;
      } catch (e) {
        log('startTinyEmu threw:', e);
      }
    }

    if (typeof Module !== 'undefined' && typeof Module.start === 'function') {
      try {
        Module.start({ kernel: KERNEL_PATH, disk: diskPath, canvas });
        return;
      } catch (e) {
        log('Module.start threw:', e);
      }
    }

    if (typeof TinyEmu === 'function') {
      try {
        new TinyEmu({ canvas, kernel: KERNEL_PATH, disk: diskPath });
        return;
      } catch (e) {
        log('TinyEmu constructor threw:', e);
      }
    }

    log('No known TinyEMU start API found. Please adapt bootTinyEmu() to call your tinyemu init.');
    setStatus('Disk prepared. Adapt app.js to start TinyEMU.');
  }

  // Start handler
  async function onStart() {
    startBtn.disabled = true;
    setStatus('Waiting for runtime...');
    resetProgress();
    log('Start VM clicked');

    try {
      // Wait for Module.FS to be available
      await waitForModuleFS().catch(err => {
        // Provide a clear error if FS never appears
        throw new Error('Emscripten runtime did not initialize: ' + (err && err.message ? err.message : 'timeout'));
      });

      // Assemble parts into disk
      const diskPath = await assemblePartsToDisk();

      // Small delay to ensure FS stability on some browsers
      await new Promise(r => setTimeout(r, 200));

      // Boot TinyEMU
      bootTinyEmu(diskPath);

      stopBtn.disabled = false;
      setStatus('VM running (or disk prepared)');
    } catch (err) {
      log('Error during assembly or start:', err && err.message ? err.message : err);
      setStatus('Error during assembly or start: ' + (err && err.message ? err.message : String(err)));
      startBtn.disabled = false;
      resetProgress();
    }
  }

  // Stop handler
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
