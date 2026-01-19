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
let currentSpace = null;

// ---------- helpers ----------
function setStatus(msg) {
  statusEl.textContent = msg || "";
}

function isAdmin() {
  return sessionStorage.getItem("isAdmin") === "true";
}

function buildGatewayUrl(cid, filename) {
  const safeName = encodeURIComponent(filename);
  return `https://${cid}.ipfs.w3s.link/${safeName}`;
}

async function ensureClient() {
  if (!storachaClient) {
    storachaClient = await create();
  }
  return storachaClient;
}

// ---------- AUTH ----------
async function loginStoracha(email) {
  const client = await ensureClient();
  setStatus("Sending login email… confirm and return here.");
  await client.login(email);
  setStatus("Storacha login confirmed ✅");
}

// ✅ FIX: resolve space from authorized list
async function resolveSpace(spaceDid) {
  const client = await ensureClient();

  const spaces = await client.spaces(); // authorized spaces
  const match = spaces.find(s => s.did() === spaceDid);

  if (!match) {
    throw new Error("This Space is not authorized for this email session.");
  }

  currentSpace = match;
  await client.setCurrentSpace(match);

  setStatus("Space selected ✅");
}

// ---------- FILE HELPERS ----------
async function getTakenAt(file) {
  try {
    if (file.type.startsWith("image/") && window.exifr) {
      const exif = await window.exifr.parse(file);
      const dt = exif?.DateTimeOriginal || exif?.CreateDate;
      if (dt) return new Date(dt);
    }
  } catch {}
  return new Date(file.lastModified || Date.now());
}

function fileTypeFromMime(file) {
  return file.type.startsWith("video/") ? "video" : "photo";
}

function renderSelectedFiles(files) {
  fileList.innerHTML = "";
  for (const file of files) {
    const div = document.createElement("div");
    div.className = "file-item";
    div.dataset.filename = file.name;
    div.innerHTML = `
      <strong>${file.name}</strong>
      <small>${file.type} • ${(file.size / 1024 / 1024).toFixed(2)} MB</small>
      <input class="caption-input" placeholder="Caption (optional)" />
    `;
    fileList.appendChild(div);
  }
}

function getCaption(filename) {
  const el = [...document.querySelectorAll(".file-item")]
    .find(x => x.dataset.filename === filename);
  return el?.querySelector("input")?.value?.trim() || null;
}

// ---------- EVENTS ----------
loginBtn.addEventListener("click", async () => {
  try {
    if (!isAdmin()) return setStatus("Admin only.");
    const email = emailInput.value.trim();
    if (!email) return setStatus("Enter admin email.");
    localStorage.setItem("mv_admin_email", email);
    await loginStoracha(email);
  } catch (e) {
    console.error(e);
    setStatus("Login failed.");
  }
});

saveSpaceBtn.addEventListener("click", async () => {
  try {
    if (!isAdmin()) return setStatus("Admin only.");
    const did = spaceDidInput.value.trim();
    if (!did.startsWith("did:")) return setStatus("Invalid Space DID.");
    localStorage.setItem("mv_space_did", did);
    await resolveSpace(did);
  } catch (e) {
    console.error(e);
    setStatus(e.message || "Could not set Space.");
  }
});

fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  renderSelectedFiles(files);
});

startUploadBtn.addEventListener("click", async () => {
  try {
    if (!isAdmin()) return setStatus("Admin only.");
    if (!currentSpace) return setStatus("Select Space first.");

    const files = [...fileInput.files];
    if (!files.length) return setStatus("Choose files.");

    setStatus("Uploading…");

    for (const file of files) {
      const takenAt = await getTakenAt(file);
      const caption = getCaption(file.name);

      const cid = await storachaClient.uploadFile(file);
      const url = buildGatewayUrl(cid, file.name);

      await window.supabaseClient.from("memories").insert([{
        file_url: url,
        file_type: fileTypeFromMime(file),
        caption,
        taken_at: takenAt.toISOString()
      }]);
    }

    setStatus("Upload complete ✅");
    fileInput.value = "";
    fileList.innerHTML = "";
    await window.loadMemories();
  } catch (e) {
    console.error(e);
    setStatus("Upload failed. Check console.");
  }
});
