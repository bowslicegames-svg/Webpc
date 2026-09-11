// app.js
// Behavior:
// - On Start VM: try direct disk.raw fetch; if not available, download release ZIP and extract disk.raw.
// - Write disk.raw into Emscripten FS at /disk/disk.raw (temporary in browser).
// - Start TinyEMU with kernel 'wasm/vmlinux' and disk '/disk/disk.raw'.
// - Show progress and logs.
//
// Requirements:
// - tinyemu.js must expose Module and a startTinyEmu-like entrypoint (adapt startTinyEmu call to your TinyEMU init).
// - CORS must be enabled on the release asset or disk.raw host.
// - For very large ZIPs this may be memory heavy; prefer hosting disk.raw unzipped if possible.

(function () {
  const ZIP_RELEASE_URL = 'https://github.com/bowslicegames-svg/Webpc/releases/download/Zip/disk.zip';
  // If you can host disk.raw directly (recommended), set DISK_RAW_URL to that direct URL.
  // Example (if you uploaded disk.raw as a release asset directly): 
  // const DISK_RAW_URL = 'https://github.com/bowslicegames-svg/Webpc/releases/download/Zip/disk.raw';
  const DISK_RAW_URL = null; // leave null to force ZIP path

  const startBtn = document.getElementById('start-vm');
  const stopBtn = document.getElementById('stop-vm');
  const progressBar = document.querySelector('#progress > i');
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('log');

  let tinyEmuInstance = null;
  let vmRunning = false;

  function log(...args) {
    const s = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
    logEl.textContent += s + '\n';
    logEl.scrollTop = logEl.scrollHeight;
    console.debug(...args);
  }

  function setStatus(s) {
    statusEl.textContent = s;
  }

  function setProgressFraction(frac) {
    const pct = Math.min(100, Math.round(frac * 100));
    progressBar.style.width = pct + '%';
  }

  function resetProgress() {
    setProgressFraction(0);
  }

  async function tryFetchDirectDiskRaw(url, onProgress) {
    if (!url) return null;
    log('Attempting direct fetch of disk.raw from', url);
    const resp = await fetch(url, { method: 'GET' });
    if (!resp.ok) {
      log('Direct fetch failed with status', resp.status);
      return null;
    }
    // If content-length present, stream and write to FS in chunks
    const contentLength = resp.headers.get('content-length');
    const reader = resp.body.getReader();
    const total = contentLength ? parseInt(contentLength, 10) : null;
    let received = 0;

    // Ensure FS path exists
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

  // Download ZIP fully (may be memory heavy), unzip with fflate, extract disk.raw and write to FS in chunks.
  async function fetchAndExtractDiskZip(zipUrl, onProgress) {
    log('Downloading ZIP from', zipUrl);
    setStatus('Downloading ZIP...');
    resetProgress();

    const resp = await fetch(zipUrl);
    if (!resp.ok) throw new Error('Failed to download ZIP: ' + resp.status);
    const reader = resp.body.getReader();
    const chunks = [];
    let received = 0;
    const contentLength = resp.headers.get('content-length');
    const total = contentLength ? parseInt(contentLength, 10) : null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (onProgress) onProgress(received, total);
    }

    setProgressFraction(0.5);
    setStatus('Unzipping in browser (this may take a while)...');
    log('ZIP downloaded, total bytes:', received);

    // Concatenate into single Uint8Array
    const buf = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) { buf.set(c, offset); offset += c.length; }

    // Use fflate to unzip
    log('Unzipping with fflate...');
    // fflate.unzipSync returns an object mapping filenames to Uint8Array
    const files = fflate.unzipSync(buf);
    log('Unzip complete, entries:', Object.keys(files).length);

    // Find disk.raw entry
    const entryName = Object.keys(files).find(n => n.endsWith('disk.raw'));
    if (!entryName) throw new Error('disk.raw not found inside ZIP');

    const diskBytes = files[entryName];
    log('disk.raw size (bytes):', diskBytes.length);

    // Write to FS in chunks to avoid a single huge allocation in FS.write
    try { Module.FS.mkdir('/disk'); } catch (e) {}
    const fd = Module.FS.open('/disk/disk.raw', 'w+');
    const CHUNK = 4 * 1024 * 1024; // 4MB chunks
    let pos = 0;
    while (pos < diskBytes.length) {
      const end = Math.min(pos + CHUNK, diskBytes.length);
      const slice = diskBytes.subarray(pos, end);
      Module.FS.write(fd, slice, 0, slice.length, pos);
      pos = end;
      setProgressFraction(0.5 + 0.5 * (pos / diskBytes.length));
    }
    Module.FS.close(fd);
    log('disk.raw written to /disk/disk.raw');
    return '/disk/disk.raw';
  }

  // Main handler invoked when user clicks Start VM
  async function onStartVm() {
    if (vmRunning) {
      log('VM already running');
      return;
    }
    startBtn.disabled = true;
    setStatus('Preparing disk image...');
    resetProgress();

    try {
      // Try direct disk.raw fetch first (recommended if available)
      let diskPath = null;
      if (DISK_RAW_URL) {
        try {
          diskPath = await tryFetchDirectDiskRaw(DISK_RAW_URL, (received, total) => {
            if (total) setProgressFraction(received / total);
            else setProgressFraction(Math.min(0.9, received / (1024*1024*100))); // heuristic
          });
        } catch (err) {
          log('Direct disk.raw fetch failed:', err.message);
          diskPath = null;
        }
      }

      // If direct fetch not available, download ZIP and extract
      if (!diskPath) {
        diskPath = await fetchAndExtractDiskZip(ZIP_RELEASE_URL, (received, total) => {
          if (total) setProgressFraction(received / total);
          else setProgressFraction(Math.min(0.45, received / (1024*1024*500))); // heuristic
        });
      }

      setStatus('Disk ready, starting TinyEMU...');
      setProgressFraction(1);

      // Start TinyEMU. Adapt this call to your tinyemu.js API.
      // Many tinyemu.js builds expose a Module or a start function. Replace startTinyEmu below
      // with the actual initialization call your build expects.
      //
      // Example placeholder:
      if (typeof startTinyEmu === 'function') {
        // If your startTinyEmu accepts an options object:
        startTinyEmu({
          kernelUrl: 'wasm/vmlinux',   // your kernel already in docs/wasm
          diskPath: diskPath,          // '/disk/disk.raw' in Emscripten FS
          // other options your tinyemu build expects...
        });
      } else if (typeof Module !== 'undefined' && Module.start) {
        // Some builds expose Module.start
        Module.start({ kernel: 'wasm/vmlinux', disk: diskPath });
      } else {
        log('No known TinyEMU start function found. You must adapt app.js to call your tinyemu init.');
        setStatus('Ready (disk extracted). Adapt app.js to start TinyEMU.');
      }

      vmRunning = true;
      stopBtn.disabled = false;
      setStatus('VM running');
      log('VM started (or disk prepared).');
    } catch (err) {
      log('Error preparing disk or starting VM:', err && err.message ? err.message : err);
      setStatus('Error: ' + (err && err.message ? err.message : String(err)));
      startBtn.disabled = false;
      resetProgress();
    }
  }

  // Stop VM handler (best-effort; adapt to your tinyemu API)
  function onStopVm() {
    if (!vmRunning) return;
    // If your tinyemu exposes a stop/shutdown API, call it here.
    if (typeof stopTinyEmu === 'function') {
      stopTinyEmu();
    } else if (typeof Module !== 'undefined' && Module.stop) {
      Module.stop();
    } else {
      log('No TinyEMU stop function found; reload page to fully stop.');
    }
    vmRunning = false;
    stopBtn.disabled = true;
    startBtn.disabled = false;
    setStatus('Stopped');
    resetProgress();
  }

  startBtn.addEventListener('click', onStartVm);
  stopBtn.addEventListener('click', onStopVm);

  // Small helper UI functions (you can replace with your own)
  window.showProgress = (msg) => {
    setStatus(msg);
  };
  window.showError = (msg) => {
    log('ERROR: ' + msg);
    setStatus('Error: ' + msg);
  };

  // Expose for debugging
  window._webpc = {
    tryFetchDirectDiskRaw,
    fetchAndExtractDiskZip
  };

  log('app.js loaded. Click Start VM to download and extract disk.raw on demand.');
})();
