// upload.js (ESM module)

// Import Storacha client in browser via ESM CDN.
// This follows Storacha docs: persistent browser client can login via email,
// then select a Space and upload with uploadFile. :contentReference[oaicite:2]{index=2}
import { create } from "https://esm.sh/@storacha/client@latest";

const uploadPanel = document.getElementById("upload-panel");
const uploadBtn = document.getElementById("upload-btn");

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
  statusEl.textContent = msg;
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

async function ensureStorachaClient() {
  if (!storachaClient) storachaClient = await create();
  return storachaClient;
}

async function loginStoracha(email) {
  const client = await ensureStorachaClient();
  setStatus("Sending login email… check your inbox and click the confirmation link.");
  await client.login(email); // resolves after email confirmation :contentReference[oaicite:3]{index=3}
  setStatus("Storacha login confirmed ✅");
}

async function setSpace(spaceDid) {
  const client = await ensureStorachaClient();
  await client.setCurrentSpace(spaceDid);
  setStatus("Space selected ✅");
}

// Photo timestamp from EXIF; fallback to file.lastModified.
// EXIF is the desired source for real memory date/time. :contentReference[oaicite:4]{index=4}
async function getTakenAt(file) {
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
    // ignore and fallback
    console.warn("EXIF parse failed:", e);
  }

  // Fallback (also used for many videos in browsers)
  return new Date(file.lastModified || Date.now());
}

// Storacha gateways: Storacha docs show path-style gateway URLs like:
// https://storacha.link/ipfs/<cid>/<filename> :contentReference[oaicite:5]{index=5}
function buildGatewayUrl(rootCid, filename) {
  const safeName = encodeURIComponent(filename);
  return `https://storacha.link/ipfs/${rootCid}/${safeName}`;
}

function fileTypeFromMime(file) {
  return file.type.startsWith("video/") ? "video" : "photo";
}

function clearFileList() {
  fileList.innerHTML = "";
}

// Create UI list with caption inputs for each file
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

// ---------- events ----------
loadSavedConfig();

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

    // Ensure storacha client is ready and space selected
    await ensureStorachaClient();
    // If not yet logged in, login will trigger and wait for confirmation.
    // If already logged in (persisted), this is quick. :contentReference[oaicite:6]{index=6}
    await loginStoracha(email);
    await setSpace(spaceDid);

    setStatus("Uploading…");

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const caption = getCaptionForFilename(file.name);
      const takenAt = await getTakenAt(file);

      setStatus(`Uploading ${i + 1}/${files.length}: ${file.name}`);

      // Upload single file; returns a root CID (often a directory wrapper)
      const rootCid = await storachaClient.uploadFile(file); // :contentReference[oaicite:7]{index=7}

      const url = buildGatewayUrl(rootCid, file.name);
      const type = fileTypeFromMime(file);

      // Insert metadata into Supabase
      const { error } = await window.supabaseClient
        .from("memories")
        .insert([{
          file_url: url,
          file_type: type,
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
