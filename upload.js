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
  if (!storachaClient) storachaClient = await create();
  return storachaClient;
}

function ensureDebugUI() {
  let box = document.getElementById("space-debug");
  if (box) return box;

  box = document.createElement("div");
  box.id = "space-debug";
  box.style.marginTop = "10px";
  box.style.padding = "10px";
  box.style.borderRadius = "10px";
  box.style.background = "rgba(255,255,255,0.7)";
  box.innerHTML = `
    <div style="font-weight:bold;margin-bottom:6px;">Spaces detected in this browser session:</div>
    <div id="space-debug-list" style="display:grid;gap:6px;"></div>
  `;

  statusEl.parentElement.insertBefore(box, statusEl);
  return box;
}

function renderSpaces(spaces) {
  ensureDebugUI();
  const list = document.getElementById("space-debug-list");
  list.innerHTML = "";

  if (!spaces || spaces.length === 0) {
    list.innerHTML = `<div style="color:#b00020;">No spaces found for this login.</div>`;
    return;
  }

  for (const s of spaces) {
    const did = typeof s.did === "function" ? s.did() : (s.did || "");
    const name = typeof s.name === "function" ? s.name() : (s.name || "Unnamed space");

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "secondary";
    btn.style.textAlign = "left";
    btn.style.padding = "10px";
    btn.style.borderRadius = "10px";
    btn.style.width = "100%";
    btn.innerHTML = `
      <div style="font-weight:bold;">${name}</div>
      <div style="font-size:12px;opacity:0.85;">${did}</div>
    `;

    btn.addEventListener("click", async () => {
      try {
        const client = await ensureClient();
        await client.setCurrentSpace(s);
        currentSpace = s;
        spaceDidInput.value = did;
        setStatus("Space selected ✅ (clicked from list)");
      } catch (e) {
        console.error(e);
        setStatus("Could not select this space. Check console.");
      }
    });

    list.appendChild(btn);
  }
}

// ---------- AUTH ----------
async function loginStoracha(email) {
  const client = await ensureClient();

  setStatus("Sending login email… confirm and return here.");
  await client.login(email);
  setStatus("Storacha login confirmed ✅");

  // After login, list spaces visible to this session
  try {
    const spaces = await client.spaces();
    renderSpaces(spaces);
    setStatus(`Storacha login confirmed ✅ • Spaces found: ${spaces.length}`);
  } catch (e) {
    console.error(e);
    setStatus("Logged in, but could not list spaces. Check console.");
  }
}

// Manual DID selection (tries to match visible spaces)
async function selectSpaceByDid(spaceDid) {
  const client = await ensureClient();
  const spaces = await client.spaces();
  renderSpaces(spaces);

  const match = spaces.find(s => {
    const did = typeof s.did === "function" ? s.did() : s.did;
    return did === spaceDid;
  });

  if (!match) {
    throw new Error(
      "That Space DID is not visible to this login session. You are likely logged into a different Storacha account/email."
    );
  }

  await client.setCurrentSpace(match);
  currentSpace = match;
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
      <small>${file.type || "unknown"} • ${(file.size / 1024 / 1024).toFixed(2)} MB</small>
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
    if (!isAdmin()) return setStatus("Admin only. Use Admin PIN to unlock upload.");

    const email = emailInput.value.trim();
    if (!email) return setStatus("Enter admin email.");

    localStorage.setItem("mv_admin_email", email);
    await loginStoracha(email);
  } catch (e) {
    console.error(e);
    setStatus("Login failed. Check console.");
  }
});

saveSpaceBtn.addEventListener("click", async () => {
  try {
    if (!isAdmin()) return setStatus("Admin only.");

    const did = spaceDidInput.value.trim();
    if (!did.startsWith("did:")) return setStatus("Invalid Space DID.");

    localStorage.setItem("mv_space_did", did);

    setStatus("Selecting space…");
    await selectSpaceByDid(did);
  } catch (e) {
    console.error(e);
    setStatus(e.message || "Could not set Space.");
  }
});

fileInput.addEventListener("change", () => {
  const files = fileInput.files ? Array.from(fileInput.files) : [];
  renderSelectedFiles(files);
});

startUploadBtn.addEventListener("click", async () => {
  try {
    if (!isAdmin()) return setStatus("Admin only.");
    if (!currentSpace) return setStatus("Select Space first (use Login, then click your space).");

    const files = fileInput.files ? Array.from(fileInput.files) : [];
    if (!files.length) return setStatus("Choose files.");

    if (!window.supabaseClient) return setStatus("Supabase not connected. Check supabase.js.");

    setStatus("Uploading…");

    for (const file of files) {
      const takenAt = await getTakenAt(file);
      const caption = getCaption(file.name);

      const cid = await storachaClient.uploadFile(file);
      const url = buildGatewayUrl(cid, file.name);

      const { error } = await window.supabaseClient.from("memories").insert([{
        file_url: url,
        file_type: fileTypeFromMime(file),
        caption,
        taken_at: takenAt.toISOString()
      }]);

      if (error) {
        console.error(error);
        setStatus("Uploaded file, but failed saving to Supabase (check console).");
        return;
      }
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
