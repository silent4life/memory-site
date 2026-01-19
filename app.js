// TEMP debug (remove later)
alert("app.js loaded");

const pinBtn = document.getElementById("pin-btn");
const pinInput = document.getElementById("pin-input");
const pinError = document.getElementById("pin-error");

const pinScreen = document.getElementById("pin-screen");
const galleryScreen = document.getElementById("gallery-screen");

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

pinBtn.addEventListener("click", async () => {
  pinError.textContent = "";
  const pin = pinInput.value.trim();

  if (!/^\d{4}$/.test(pin)) {
    pinError.textContent = "PIN must be exactly 4 digits";
    return;
  }

  if (!window.supabaseClient) {
    pinError.textContent = "Supabase not connected. Check supabase.js + script order.";
    return;
  }

  const { data, error } = await window.supabaseClient
    .from("settings")
    .select("value")
    .eq("key", "pin_hash")
    .single();

  if (error) {
    pinError.textContent = "Could not check PIN. Try again.";
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
});
