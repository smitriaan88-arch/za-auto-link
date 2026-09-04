/* =========================================================================
   FIREBASE CONFIG — paste the values from your Firebase project here.
   Firebase Console → Project Settings → Your apps → (the web app) → SDK setup.
   This same file is loaded by both index.html and admin.html.
   ========================================================================= */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCLLgYfPsTBFXiZ4n4WrN_nOoU69VPz91A",
  authDomain: "za-auto-link.firebaseapp.com",
  projectId: "za-auto-link",
  storageBucket: "za-auto-link.firebasestorage.app",
  messagingSenderId: "828508121734",
  appId: "1:828508121734:web:956f03e631d5fba4b4bf07",
};

/* =========================================================================
   CLOUDINARY — used for vehicle photo uploads (free tier, no card needed).
   Cloudinary dashboard → copy your Cloud Name.
   Settings → Upload → Upload presets → Add upload preset → Signing Mode:
   Unsigned → Save → copy its name.
   ========================================================================= */
const CLOUDINARY_CLOUD_NAME = "zwgnsffi";
const CLOUDINARY_UPLOAD_PRESET = "ml_default";

/* Still used for instant email notifications alongside the database —
   same Formspree endpoint as before. Leave as-is if you want to keep it. */
const NOTIFY_ENDPOINT = "https://formspree.io/f/mojobabd";
const CONTACT_EMAIL = "sales@zaautolink.co.za";
const WHATSAPP_NUMBER = "27690340644"; // +27 69 034 0644, no + or spaces

firebase.initializeApp(FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

// Uploads one image file to Cloudinary and returns its public URL.
async function uploadImageToCloudinary(file) {
  if (CLOUDINARY_CLOUD_NAME.startsWith("YOUR_")) {
    throw new Error("Cloudinary isn't configured yet. Fill in CLOUDINARY_CLOUD_NAME / CLOUDINARY_UPLOAD_PRESET in firebase-config.js.");
  }
  const formData = new FormData();
  formData.append("file", file);
  formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    let msg = "Image upload failed (" + res.status + ")";
    try { const err = await res.json(); if (err && err.error && err.error.message) msg = err.error.message; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const data = await res.json();
  return data.secure_url;
}

// Returns a faster-loading version of a Cloudinary URL — auto format (WebP/AVIF
// where supported), auto quality, and resized to roughly the size it'll display
// at. Leaves non-Cloudinary URLs untouched. width is optional (omit to only
// optimize format/quality without resizing).
function cldOptimize(url, width) {
  if (!url || !url.includes("/upload/")) return url;
  const transform = width ? `f_auto,q_auto,w_${width}` : "f_auto,q_auto";
  return url.replace("/upload/", `/upload/${transform}/`);
}

// Best-effort email ping — failures here never block the real save to Firestore.
async function notifyByEmail(subject, fromName, replyTo, fields) {
  try {
    if (NOTIFY_ENDPOINT.includes("YOUR_") ) return;
    const message = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");
    await fetch(NOTIFY_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ _subject: subject, name: fromName || "Website visitor", email: replyTo || CONTACT_EMAIL, message }),
    });
  } catch (e) {
    console.warn("Email notification failed (data was still saved):", e);
  }
}
