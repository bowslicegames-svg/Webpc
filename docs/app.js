// app.js — temporary client-side commit example (NOT for large files)
document.getElementById('upload').addEventListener('click', async () => {
  const fileInput = document.getElementById('file');
  const pathInput = document.getElementById('path');
  if (!fileInput.files.length) return alert('Choose a file first');

  const file = fileInput.files[0];
  const repoOwner = 'YOUR_GITHUB_USERNAME_OR_ORG';
  const repoName = 'YOUR_REPO_NAME';
  const branch = 'main'; // branch to commit to
  const commitPath = pathInput.value || `uploads/${file.name}`;

  // === SECURITY: replace with a secure server-side token exchange ===
  const GITHUB_TOKEN = prompt('Paste a GitHub Personal Access Token (repo scope) for testing only');

  if (!GITHUB_TOKEN) return alert('No token provided');

  // Read file as base64
  const toBase64 = f => new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => {
      const b64 = reader.result.split(',')[1];
      res(b64);
    };
    reader.onerror = rej;
    reader.readAsDataURL(f);
  });

  try {
    const contentB64 = await toBase64(file);

    // Check if file exists to get sha (for update)
    const getUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${encodeURIComponent(commitPath)}?ref=${branch}`;
    const headers = { Authorization: `token ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' };

    let sha = null;
    const getResp = await fetch(getUrl, { headers });
    if (getResp.status === 200) {
      const json = await getResp.json();
      sha = json.sha;
    }

    const putUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${encodeURIComponent(commitPath)}`;
    const body = {
      message: sha ? `Update ${commitPath}` : `Add ${commitPath}`,
      content: contentB64,
      branch
    };
    if (sha) body.sha = sha;

    const putResp = await fetch(putUrl, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });

    if (!putResp.ok) {
      const err = await putResp.text();
      throw new Error(`GitHub API error: ${putResp.status} ${err}`);
    }

    alert('File committed to repo at: ' + commitPath);
  } catch (e) {
    alert('Upload failed: ' + e.message);
  }
});
