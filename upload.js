// upload.js (ESM module)
// Full updated version with URL builder using: https://<CID>.ipfs.w3s.link/<filename>

import { create } from "https://esm.sh/@storacha/client@latest";

const emailInput = document.getElementById("admin-email");
const loginBtn = document.getElementById("login-storacha-btn");

const spaceDidInput = document.getElementById("space-did");
const saveSpaceBtn = document.getElementById("save-space-btn");

const fileInput = document.getElementById("file-input");
const startUploadBtn = document.getElementById("start-upload-btn");

const fileList = document.getElementById("file-list");
const statusEl = document.getElementById("upload-status");

let storachaClient = null;

// ---------- helpers ----------
function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function isUnlocked() {
  return sessionStorage.getItem("unlocked") === "true";
}

function loadSavedConfig() {
  const email = localStorage.getItem("mv_admin_email") || "";
  const spaceDid = localStorage.getItem("mv_space_did") || "";
  emailInput.value = email;
  spaceDidInput.value = spaceDid;
}

// ✅ URL builder (matches what you pasted)
// Example: https://bafy...ipfs.w3s.link/IMG_1234.jpg
function buildGatewayUrl(cid, filename) {
  const safeName = encodeURIComponent(filename);
  return `https://${cid}.ipfs.w3s.link/${safeName}`;
}

async function ensureStorachaClient() {
  if (!storachaClient) storachaClient = await create();
  return storachaClient;
}

async function loginStoracha(email) {
  const client = await ensureStorachaClient();
  setStatus("Sending login email… check inbox and click confirmation link.");
  await client.login(email); // waits for login confirmation
  setStatus("Storacha login confirmed ✅");
}

async function setSpace(spaceDid) {
  const client = await ensureStorachaClient();
  await client.setCurrentSpace(spaceDid);
  setStatus("Space selected ✅");
}

// Photo timestamp from EXIF; fallback to file.lastModified (and upload time)
async function getTakenAt(file) {
  // Prefer EXIF for images
  try {
    const isImage = file.type.startsWith("image/");
    if (isImage && window.exifr) {
      const exif = await window.exifr.parse(file, { translateValues: true });
      const dt =
        exif?.DateTimeOriginal ||
        exif?.CreateDate ||
        exif?.ModifyDate;

      if (dt instanceof Date && !isNaN(dt.getTime())) return dt;

      if (typeof dt === "string") {
        const parsed = new Date(dt);
        if (!isNaN(parsed.getTime())) return parsed;
      }
    }
  } catch (e) {
    console.warn("EXIF parse failed:", e);
  }

  // Fallback: lastModified works for many videos
  const fallback = file.lastModified ? new Date(file.lastModified) : new Date();
  return fallback;
}

function fileTypeFromMime(file) {
  return file.type.startsWith("video/") ? "video" : "photo";
}

function clearFileList() {
  fileList.innerHTML = "";
}

function renderSelectedFiles(files) {
  clearFileList();
  for (const file of files) {
    const div = document.createElement("div");
    div.className = "file-item";
    div.dataset.filename = file.name;

    div.innerHTML = `
      <div><strong>${file.name}</strong></div>
      <small>${file.type || "unknown"} • ${(file.size / (1024 * 1024)).toFixed(2)} MB</small>
      <input class="caption-input" type="text" placeholder="Caption (optional)"/>
    `;

    fileList.appendChild(div);
  }
}

function getCaptionForFilename(filename) {
  const item = [...document.querySelectorAll(".file-item")].find(x => x.dataset.filename === filename);
  if (!item) return "";
  const input = item.querySelector(".caption-input");
  return (input?.value || "").trim();
}

// ---------- init ----------
loadSavedConfig();

// ---------- events ----------
loginBtn.addEventListener("click", async () => {
  try {
    if (!isUnlocked()) return;

    const email = emailInput.value.trim();
    if (!email) {
      setStatus("Enter your admin email first.");
      return;
    }

    localStorage.setItem("mv_admin_email", email);
    await loginStoracha(email);
  } catch (e) {
    console.error(e);
    setStatus("Login failed. Check console.");
  }
});

saveSpaceBtn.addEventListener("click", async () => {
  try {
    if (!isUnlocked()) return;

    const spaceDid = spaceDidInput.value.trim();
    if (!spaceDid.startsWith("did:")) {
      setStatus("Space DID must start with: did: ...");
      return;
    }

    localStorage.setItem("mv_space_did", spaceDid);
    await setSpace(spaceDid);
  } catch (e) {
    console.error(e);
    setStatus("Could not set Space. Check console.");
  }
});

fileInput.addEventListener("change", () => {
  const files = fileInput.files ? Array.from(fileInput.files) : [];
  if (files.length === 0) {
    clearFileList();
    setStatus("");
    return;
  }
  renderSelectedFiles(files);
  setStatus(`${files.length} file(s) selected.`);
});

startUploadBtn.addEventListener("click", async () => {
  try {
    if (!isUnlocked()) return;

    const files = fileInput.files ? Array.from(fileInput.files) : [];
    if (files.length === 0) {
      setStatus("Choose files first.");
      return;
    }

    const email = (emailInput.value || "").trim();
    const spaceDid = (spaceDidInput.value || "").trim();

    if (!email) {
      setStatus("Enter admin email and click Login first.");
      return;
    }
    if (!spaceDid) {
      setStatus("Paste your Space DID and click Save Space first.");
      return;
    }
    if (!window.supabaseClient) {
      setStatus("Supabase not connected. Check supabase.js.");
      return;
    }

    // Make sure client exists, logged in, and space selected
    await ensureStorachaClient();
    await loginStoracha(email);
    await setSpace(spaceDid);

    setStatus("Uploading…");

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const caption = getCaptionForFilename(file.name);
      const takenAt = await getTakenAt(file);

      setStatus(`Uploading ${i + 1}/${files.length}: ${file.name}`);

      // Upload file -> returns CID
      const cid = await storachaClient.uploadFile(file);

      // ✅ Build public URL using the CID + filename
      const fileUrl = buildGatewayUrl(cid, file.name);

      // Save metadata to Supabase
      const { error } = await window.supabaseClient
        .from("memories")
        .insert([{
          file_url: fileUrl,
          file_type: fileTypeFromMime(file),
          caption: caption || null,
          taken_at: takenAt.toISOString()
        }]);

      if (error) {
        console.error("Supabase insert error:", error);
        setStatus("Uploaded to Storacha, but failed saving metadata to Supabase (check console).");
        return;
      }
    }

    setStatus("All uploads complete ✅");

    // Reset UI
    fileInput.value = "";
    clearFileList();

    // Refresh gallery
    if (typeof window.loadMemories === "function") {
      await window.loadMemories();
    }
  } catch (e) {
    console.error(e);
    setStatus("Upload failed. Check console.");
  }
});
