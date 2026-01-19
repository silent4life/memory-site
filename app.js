const pinBtn = document.getElementById("pin-btn");
const pinInput = document.getElementById("pin-input");
const pinError = document.getElementById("pin-error");

const pinScreen = document.getElementById("pin-screen");
const galleryScreen = document.getElementById("gallery-screen");
const gallery = document.getElementById("gallery");

const uploadBtn = document.getElementById("upload-btn");
const uploadPanel = document.getElementById("upload-panel");

// Hash helper (SHA-256)
async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

// Load memories from Supabase and render timeline
async function loadMemories() {
  gallery.innerHTML = "<p style='padding:12px;'>Loading memories…</p>";

  const { data, error } = await window.supabaseClient
    .from("memories")
    .select("*")
    .order("taken_at", { ascending: false });

  if (error) {
    gallery.innerHTML = "<p style='padding:12px;'>Could not load memories.</p>";
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    gallery.innerHTML = "<p style='padding:12px;'>No memories yet. Upload your first one ❤️</p>";
    return;
  }

  // Group by Month-Year
  const groups = {};
  for (const m of data) {
    const d = new Date(m.taken_at);
    const groupKey = d.toLocaleString(undefined, { month: "long", year: "numeric" });
    if (!groups[groupKey]) groups[groupKey] = [];
    groups[groupKey].push(m);
  }

  gallery.innerHTML = "";

  for (const groupName of Object.keys(groups)) {
    const title = document.createElement("h3");
    title.className = "section-title";
    title.textContent = `📅 ${groupName}`;
    gallery.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "grid";

    for (const item of groups[groupName]) {
      const card = document.createElement("div");
      card.className = "card";

      const safeCaption = item.caption ? item.caption : "";

      if (item.file_type === "video") {
        card.innerHTML = `
          <video src="${item.file_url}" controls></video>
          <div class="caption">${safeCaption}</div>
          <a class="dl" href="${item.file_url}" download>⬇ Download</a>
        `;
      } else {
        card.innerHTML = `
          <img src="${item.file_url}" alt="memory"/>
          <div class="caption">${safeCaption}</div>
          <a class="dl" href="${item.file_url}" download>⬇ Download</a>
        `;
      }

      grid.appendChild(card);
    }

    gallery.appendChild(grid);
  }
}

// Toggle upload panel
uploadBtn.addEventListener("click", () => {
  uploadPanel.classList.toggle("hidden");
});

// PIN unlock
pinBtn.addEventListener("click", async () => {
  try {
    pinError.textContent = "";
    const pin = pinInput.value.trim();

    if (!/^\d{4}$/.test(pin)) {
      pinError.textContent = "PIN must be exactly 4 digits";
      return;
    }

    if (!window.supabaseClient) {
      pinError.textContent = "Supabase not connected. Check supabase.js";
      return;
    }

    const { data, error } = await window.supabaseClient
      .from("settings")
      .select("value")
      .eq("key", "pin_hash")
      .single();

    if (error || !data) {
      pinError.textContent = "Could not check PIN (database issue).";
      console.error(error);
      return;
    }

    const storedHash = data.value;
    const enteredHash = await sha256(pin);

    if (enteredHash !== storedHash) {
      pinError.textContent = "Wrong PIN";
      return;
    }

    sessionStorage.setItem("unlocked", "true");
    pinScreen.classList.add("hidden");
    galleryScreen.classList.remove("hidden");

    await loadMemories();
  } catch (e) {
    pinError.textContent = "Something went wrong. Check console.";
    console.error(e);
  }
});

// Make loadMemories available to upload.js
window.loadMemories = loadMemories;
