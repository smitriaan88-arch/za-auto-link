// ZA Auto Link — creates a linked "owner/manager/salesperson" login for a
// dealer, so a team member can check the portal under their own email and
// password and see exactly the same stock and leads as the primary account.
//
// Uses the same Firebase service account already set up for WhatsApp alerts
// (see README section 9) — creating another person's login isn't something
// a dealer's own client-side permissions can safely do themselves, so this
// runs server-side with admin access instead.
//
// Deliberately zero npm dependencies — talks to Google's REST APIs directly
// using only Node's built-in crypto module to sign the service-account
// token, rather than the firebase-admin package. A plain drag-and-drop
// deploy doesn't reliably install npm packages, so anything under /api
// needing one can silently take the *whole* folder down with it. Staying
// dependency-free keeps this bulletproof.

const crypto = require("crypto");

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function getGoogleAccessToken(scope) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  if (!clientEmail || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail, scope, aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now,
  }));
  const unsigned = `${header}.${claims}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const signature = signer.sign(privateKey).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const jwt = `${unsigned}.${signature}`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!tokenRes.ok) return null;
  const data = await tokenRes.json();
  return data.access_token || null;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  return { stringValue: String(v) };
}
function fromFirestoreValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.timestampValue !== undefined) return v.timestampValue;
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    return res.status(500).json({ error: "Not set up yet — see README section 9 for the one-time Firebase service account setup." });
  }

  try {
    const { dealerUid, email, name, role } = req.body || {};
    if (!dealerUid || !email || !name) return res.status(400).json({ error: "dealerUid, email and name are required" });

    const token = await getGoogleAccessToken(
      "https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/datastore"
    );
    if (!token) return res.status(500).json({ error: "Couldn't authenticate with the service account — check the 3 environment variables." });
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const dealerRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/dealers/${dealerUid}`,
      { headers: authHeaders }
    );
    if (!dealerRes.ok) return res.status(404).json({ error: "Dealer not found" });

    // Reuse the existing account if this email already has one (e.g. adding
    // the same person back after removing them) rather than erroring.
    let uid;
    const lookupRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:lookup`,
      { method: "POST", headers: authHeaders, body: JSON.stringify({ email: [email] }) }
    );
    const lookupData = lookupRes.ok ? await lookupRes.json() : {};
    if (lookupData.users && lookupData.users[0]) {
      uid = lookupData.users[0].localId;
    } else {
      const tempPassword = crypto.randomBytes(9).toString("base64").replace(/[+/=]/g, "x") + "Aa1!";
      const createRes = await fetch(
        `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts`,
        { method: "POST", headers: authHeaders, body: JSON.stringify({ email, password: tempPassword, emailVerified: false }) }
      );
      if (!createRes.ok) {
        const errBody = await createRes.json().catch(() => ({}));
        return res.status(500).json({ error: errBody.error?.message || "Couldn't create that login." });
      }
      const createData = await createRes.json();
      uid = createData.localId;
    }

    // This is the record onAuthStateChanged actually looks up when this
    // person logs in — without it, their account would exist but the portal
    // would have nowhere to resolve their access from.
    const existingRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/dealerTeam/${uid}`,
      { headers: authHeaders }
    );
    const existing = existingRes.ok ? (await existingRes.json()).fields || {} : {};

    const fields = {
      dealerUid: toFirestoreValue(dealerUid),
      name: toFirestoreValue(name),
      role: toFirestoreValue(role || "Manager"),
      email: toFirestoreValue(email),
      whatsappNumber: existing.whatsappNumber || toFirestoreValue(""),
      whatsappApiKey: existing.whatsappApiKey || toFirestoreValue(""),
      createdAt: existing.createdAt || { timestampValue: new Date().toISOString() },
    };
    const fieldNames = Object.keys(fields);
    const mask = fieldNames.map((f) => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join("&");
    const patchRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/dealerTeam/${uid}?${mask}`,
      { method: "PATCH", headers: authHeaders, body: JSON.stringify({ fields }) }
    );
    if (!patchRes.ok) {
      const errBody = await patchRes.json().catch(() => ({}));
      return res.status(500).json({ error: errBody.error?.message || "Login created, but saving their team record failed." });
    }

    return res.status(200).json({ ok: true, uid });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
};
