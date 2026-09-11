// docs/app.js
// Minimal, defensive client logic to download/extract disk.raw on Start VM click.
// Assumes tinyemu.js is at wasm/tinyemu.js and vmlinux is at wasm/vmlinux.
// Writes disk.raw into Emscripten FS at /disk/disk.raw and then calls your TinyEMU start function.
// If your tinyemu build exposes a different start API, replace the startTinyEmu call accordingly.

(() => {
  const ZIP_RELEASE_URL = 'https://github.com/bowslicegames-svg/Webpc/releases/download/Zip/disk.zip';
  const DISK_RAW_URL = null; // set to direct disk.raw URL if you host it uncompressed

  const $ = sel => document.querySelector(sel);
  const startBtn = $('#start-vm');
  const stopBtn = $('#stop-vm');
  const progressBar = $('#progress > i');
  const statusEl = $('#status');
  const logEl = $('#log');

  function log(...args) {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    if (logEl) {
      logEl.textContent += s + '\n';
      logEl.scrollTop = logEl.scrollHeight;
    }
    console.log(...args);
  }

  function setStatus(s) { if (statusEl) statusEl.textContent = s; }
  function setProgressFraction(f) { if (progressBar) progressBar.style.width = Math.round(Math.max(0, Math.min(1, f)) * 100) + '%'; }
  function resetProgress() { setProgressFraction(0); }

  // Wait for Emscripten Module readiness (if present)
  function waitForModuleReady(timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      if (typeof Module !== 'undefined' && (Module.calledRun || Module.onRuntimeInitialized)) {
        resolve(Module);
        return;
      }
      let resolved = false;
      if (typeof Module !== 'undefined') {
        const prev = Module.onRuntimeInitialized;
        Module.onRuntimeInitialized = function () {
          if (typeof prev === 'function') prev();
          if (!resolved) { resolved = true; resolve(Module); }
        };
      }
      const start = Date.now();
      const iv = setInterval(() => {
        if (typeof Module !== 'undefined' && (Module.calledRun || Module.onRuntimeInitialized)) {
          clearInterval(iv);
          if (!resolved) { resolved = true; resolve(Module); }
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(iv);
          if (!resolved) { resolved = true; reject(new Error('Module did not initialize in time')); }
        }
      }, 200);
    });
  }

  // Stream direct disk.raw into Emscripten FS (if available)
  async function tryFetchDirectDiskRaw(url, onProgress) {
    if (!url) return null;
    log('Attempting direct disk.raw fetch:', url);
    const resp = await fetch(url);
    if (!resp.ok) { log('Direct fetch failed:', resp.status); return null; }
    const reader = resp.body.getReader();
    const total = resp.headers.get('content-length') ? parseInt(resp.headers.get('content-length'), 10) : null;
    let received = 0;

    if (typeof Module === 'undefined' || !Module.FS) {
      throw new Error('Emscripten Module.FS not available for writing disk.raw');
    }

    try { Module.FS.mkdir('/disk'); } catch (e) {}
    const fd = Module.FS.open('/disk/disk.raw', 'w+');

    let position = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      Module.FS.write(fd, value, 0, value.length, position);
      position += value.length;
      received += value.length;
      if (onProgress) onProgress(received, total);
    }
    Module.FS.close(fd);
    log('Direct disk.raw written to /disk/disk.raw, bytes:', position);
    return '/disk/disk.raw';
  }

  // Download ZIP, unzip with fflate, write disk.raw in chunks
  async function fetchAndExtractDiskZip(zipUrl, onProgress) {
    log('Downloading ZIP:', zipUrl);
    setStatus('Downloading ZIP...');
    resetProgress();

    const resp = await fetch(zipUrl);
    if (!resp.ok) throw new Error('Failed to download ZIP: ' + resp.status);
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    const total = resp.headers.get('content-length') ? parseInt(resp.headers.get('content-length'), 10) : null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(received, total);
    }

    setProgressFraction(0.45);
    setStatus('Unzipping in browser...');
    log('ZIP downloaded, bytes:', received);

    // Concatenate
    const buf = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { buf.set(c, off); off += c.length; }

    // unzip
    const files = fflate.unzipSync(buf);
    log('Unzip entries:', Object.keys(files).length);
    const entry = Object.keys(files).find(n => n.endsWith('disk.raw'));
    if (!entry) throw new Error('disk.raw not found in ZIP');

    const diskBytes = files[entry];
    log('disk.raw size:', diskBytes.length);

    if (typeof Module === 'undefined' || !Module.FS) {
      throw new Error('Emscripten Module.FS not available for writing disk.raw');
    }

    try { Module.FS.mkdir('/disk'); } catch (e) {}
    const fd = Module.FS.open('/disk/disk.raw', 'w+');
    const CHUNK = 4 * 1024 * 1024;
    let pos = 0;
    while (pos < diskBytes.length) {
      const end = Math.min(pos + CHUNK, diskBytes.length);
      const slice = diskBytes.subarray(pos, end);
      Module.FS.write(fd, slice, 0, slice.length, pos);
      pos = end;
      setProgressFraction(0.45 + 0.55 * (pos / diskBytes.length));
    }
    Module.FS.close(fd);
    log('disk.raw written to /disk/disk.raw');
    return '/disk/disk.raw';
  }

  // Start VM handler
  async function onStartVm() {
    startBtn.disabled = true;
    setStatus('Preparing disk image...');
    resetProgress();
    log('Start VM pressed');

    try {
      // Wait a short time for Module to initialize, but continue if it doesn't
      await waitForModuleReady().catch(err => {
        log('Module readiness: ' + err.message);
      });

      let diskPath = null;

      if (DISK_RAW_URL) {
        try {
          diskPath = await tryFetchDirectDiskRaw(DISK_RAW_URL, (received, total) => {
            if (total) setProgressFraction(received / total);
            else setProgressFraction(Math.min(0.9, received / (1024*1024*100)));
          });
        } catch (err) {
          log('Direct fetch error:', err.message);
          diskPath = null;
        }
      }

      if (!diskPath) {
        diskPath = await fetchAndExtractDiskZip(ZIP_RELEASE_URL, (received, total) => {
          if (total) setProgressFraction(received / total);
          else setProgressFraction(Math.min(0.45, received / (1024*1024*500)));
        });
      }

      setStatus('Disk ready. Starting TinyEMU...');
      setProgressFraction(1);

      // Call your TinyEMU start function. Replace these with your actual API if different.
      if (typeof startTinyEmu === 'function') {
        startTinyEmu({ kernelUrl: 'wasm/vmlinux', diskPath });
      } else if (typeof Module !== 'undefined' && Module.start) {
        Module.start({ kernel: 'wasm/vmlinux', disk: diskPath });
      } else {
        log('No TinyEMU start function found. Disk prepared at', diskPath);
        setStatus('Disk prepared. Adapt app.js to call your tinyemu init.');
      }

      stopBtn.disabled = false;
      setStatus('VM running (or disk prepared)');
    } catch (err) {
      log('Error preparing disk or starting VM:', err && err.message ? err.message : err);
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

  // Attach handlers immediately (works on iPad without devtools)
  if (startBtn) startBtn.addEventListener('click', onStartVm);
  if (stopBtn) stopBtn.addEventListener('click', onStopVm);

  // Small startup log
  log('app.js loaded. Click Start VM to download and extract disk.raw on demand.');
})();
