// upload.js — Google Drive uploader (Vanilla JS)
// Works on GitHub Pages + Supabase
// Admin-only upload: requires Admin PIN unlock (sessionStorage.isAdmin === "true")
// Uploads files into a chosen Google Drive folder, makes them public (anyone with link can view),
// then saves public download URL + metadata into Supabase "memories".

// ✅ 1) PASTE YOUR GOOGLE OAUTH CLIENT ID HERE (from Google Cloud Console)
const GOOGLE_CLIENT_ID = "PASTE_YOUR_CLIENT_ID.apps.googleusercontent.com";

// ✅ 2) Drive scope: manage files this app creates/opens
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

// --- UI elements ---
const googleBtn = document.getElementById("google-signin-btn");
const folderInput = document.getElementById("drive-folder-id");
const saveFolderBtn = document.getElementById("save-folder-btn");

const fileInput = document.getElementById("file-input");
const startUploadBtn = document.getElementById("start-upload-btn");

const fileList = document.getElementById("file-list");
const statusEl = document.getElementById("upload-status");

// --- Google token state ---
let accessToken = null;
let tokenClient = null;

// ---------- helpers ----------
function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function isAdmin() {
  return sessionStorage.getItem("isAdmin") === "true";
}

function fileTypeFromMime(file) {
  return file.type && file.type.startsWith("video/") ? "video" : "photo";
}

// Direct download URL that works for viewers (no Google login needed)
function driveDownloadUrl(fileId) {
  return `https://drive.google.com/uc?export=download&id=${fileId}`;
}

// Some browsers block direct "uc?export=download" for large videos sometimes.
// If that happens later, we can switch to a "drive open" link fallback:
// https://drive.google.com/file/d/<FILE_ID>/view

async function getTakenAt(file) {
  // Use EXIF timestamp for images if present, else fallback to file.lastModified
  try {
    if (file.type && file.type.startsWith("image/") && window.exifr) {
      const exif = await window.exifr.parse(file);
      const dt = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate;
      if (dt) {
        const d = new Date(dt);
        if (!isNaN(d.getTime())) return d;
      }
    }
  } catch (e) {
    console.warn("EXIF parse failed:", e);
  }

  return new Date(file.lastModified || Date.now());
}

function renderSelectedFiles(files) {
  fileList.innerHTML = "";
  for (const file of files) {
    const div = document.createElement("div");
    div.className = "file-item";
    div.dataset.filename = file.name;

    div.innerHTML = `
      <div><strong>${file.name}</strong></div>
      <small>${file.type || "unknown"} • ${(file.size / 1024 / 1024).toFixed(2)} MB</small>
      <input class="caption-input" placeholder="Caption (optional)" />
    `;

    fileList.appendChild(div);
  }
}

function getCaption(filename) {
  const el = [...document.querySelectorAll(".file-item")].find(
    x => x.dataset.filename === filename
  );
  return el?.querySelector("input")?.value?.trim() || null;
}

function loadSavedFolder() {
  const saved = localStorage.getItem("mv_drive_folder_id") || "";
  folderInput.value = saved;
}

// ---------- Google auth (GIS token client) ----------
function initGoogleTokenClient() {
  if (!window.google?.accounts?.oauth2) return false;

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (tokenResponse) => {
      // This callback gets overwritten in ensureToken() too
      accessToken = tokenResponse.access_token;
      setStatus("Google connected ✅");
    }
  });

  return true;
}

async function ensureToken(prompt = "consent") {
  if (accessToken) return accessToken;

  if (!tokenClient) {
    const ok = initGoogleTokenClient();
    if (!ok) throw new Error("Google sign-in script not loaded yet. Refresh and try again.");
  }

  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp?.error) return reject(new Error(resp.error));
      accessToken = resp.access_token;
      setStatus("Google connected ✅");
      resolve(accessToken);
    };

    tokenClient.requestAccessToken({ prompt }); // "consent" first time, "none" later if you want
  });
}

// ---------- Drive API calls ----------
async function uploadFileToDrive(file, folderId) {
  const token = await ensureToken("consent");

  // Multipart upload: metadata + file bytes
  const metadata = {
    name: file.name,
    parents: [folderId]
  };

  const boundary = "-------314159265358979323846";
  const delimiter = `\r\n--${boundary}\r\n`;
  const closeDelim = `\r\n--${boundary}--`;

  const fileBuffer = await file.arrayBuffer();

  const body = new Blob(
    [
      delimiter,
      "Content-Type: application/json; charset=UTF-8\r\n\r\n",
      JSON.stringify(metadata),
      delimiter,
      `Content-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
      new Uint8Array(fileBuffer),
      closeDelim
    ],
    { type: `multipart/related; boundary=${boundary}` }
  );

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,createdTime",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`
      },
      body
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error("Drive upload failed: " + txt);
  }

  return await res.json(); // {id, name, createdTime}
}

async function makeFilePublic(fileId) {
  const token = await ensureToken("none");

  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      role: "reader",
      type: "anyone"
    })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error("Sharing failed: " + txt);
  }
}

async function saveMemoryToSupabase({ fileUrl, fileType, caption, takenAtISO }) {
  if (!window.supabaseClient) throw new Error("Supabase not connected (supabase.js missing).");

  const { error } = await window.supabaseClient.from("memories").insert([
    {
      file_url: fileUrl,
      file_type: fileType,
      caption: caption || null,
      taken_at: takenAtISO
    }
  ]);

  if (error) throw new Error("Supabase insert failed: " + error.message);
}

// ---------- UI events ----------
loadSavedFolder();

googleBtn.addEventListener("click", async () => {
  try {
    if (!isAdmin()) return setStatus("Admin only. Unlock Admin first.");
    if (GOOGLE_CLIENT_ID.includes("PASTE_YOUR_CLIENT_ID")) {
      return setStatus("Paste your Google Client ID into upload.js first.");
    }
    await ensureToken("consent");
  } catch (e) {
    console.error(e);
    setStatus("Google sign-in failed. Check console.");
  }
});

saveFolderBtn.addEventListener("click", () => {
  if (!isAdmin()) return setStatus("Admin only. Unlock Admin first.");
  const id = folderInput.value.trim();
  if (!id) return setStatus("Paste your Drive Folder ID first.");
  localStorage.setItem("mv_drive_folder_id", id);
  setStatus("Folder saved ✅");
});

fileInput.addEventListener("change", () => {
  const files = fileInput.files ? Array.from(fileInput.files) : [];
  if (!files.length) {
    fileList.innerHTML = "";
    setStatus("");
    return;
  }
  renderSelectedFiles(files);
  setStatus(`${files.length} file(s) selected.`);
});

startUploadBtn.addEventListener("click", async () => {
  try {
    if (!isAdmin()) return setStatus("Admin only. Unlock Admin first.");

    if (GOOGLE_CLIENT_ID.includes("PASTE_YOUR_CLIENT_ID")) {
      return setStatus("Paste your Google Client ID into upload.js first.");
    }

    const folderId = folderInput.value.trim();
    if (!folderId) return setStatus("Paste your Drive Folder ID and click Save Folder.");

    const files = fileInput.files ? Array.from(fileInput.files) : [];
    if (!files.length) return setStatus("Choose files first.");

    // Ensure signed in
    await ensureToken("consent");

    setStatus("Uploading…");

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setStatus(`Uploading ${i + 1}/${files.length}: ${file.name}`);

      const takenAt = await getTakenAt(file);
      const caption = getCaption(file.name);

      // 1) Upload to Drive
      const uploaded = await uploadFileToDrive(file, folderId);

      // 2) Make file public
      await makeFilePublic(uploaded.id);

      // 3) Save metadata to Supabase
      const publicUrl = driveDownloadUrl(uploaded.id);

      await saveMemoryToSupabase({
        fileUrl: publicUrl,
        fileType: fileTypeFromMime(file),
        caption,
        takenAtISO: takenAt.toISOString()
      });
    }

    setStatus("All uploads complete ✅");

    // Reset UI
    fileInput.value = "";
    fileList.innerHTML = "";

    // Refresh gallery
    if (typeof window.loadMemories === "function") {
      await window.loadMemories();
    }
  } catch (e) {
    console.error(e);
    setStatus(e.message || "Upload failed. Check console.");
  }
});
