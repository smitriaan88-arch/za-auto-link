// ZA Auto Link — free WhatsApp lead alerts (interim bridge, not the official
// WhatsApp Business API). Uses CallMeBot, a free hobby-run service — no
// account, no monthly cost, but no uptime guarantee either. The primary
// dealer AND every team member (owner/manager/salesperson) they've added
// each opt in individually and can only ever receive messages at their own
// number.
//
// This needs privileged server-side access (unlike our other /api functions)
// because these are private credentials — if one leaked, anyone could use it
// to spam that person's WhatsApp. They must never be readable by the public
// REST trick our other functions use, so this one authenticates with a
// Firebase service account instead. See README.md for the one-time setup
// (3 environment variables in Vercel).
//
// Deliberately zero npm dependencies — talks to Google's REST APIs directly
// using only Node's built-in crypto module to sign the service-account
// token. A plain drag-and-drop deploy doesn't reliably install npm packages,
// so anything under /api needing a package can silently take the *whole*
// folder down with it. Staying dependency-free keeps this bulletproof.

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

function fromFirestoreValue(v) {
  if (!v) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.mapValue !== undefined) return fromFirestoreFields(v.mapValue.fields || {});
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(fromFirestoreValue);
  return null;
}
function fromFirestoreFields(fields) {
  const out = {};
  for (const k in fields) out[k] = fromFirestoreValue(fields[k]);
  return out;
}

async function sendCallMeBot(phone, apikey, message) {
  const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(apikey)}`;
  try {
    const cmbRes = await fetch(url);
    return cmbRes.ok;
  } catch {
    return false;
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId || !process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
    // Not configured yet is a normal, expected state — fail quietly so it
    // never breaks the lead itself, which is already safely saved by now.
    return res.status(200).json({ sent: false, reason: "not_configured" });
  }

  try {
    const { dealerUid, message } = req.body || {};
    if (!dealerUid || !message) return res.status(400).json({ error: "dealerUid and message are required" });

    const token = await getGoogleAccessToken("https://www.googleapis.com/auth/datastore");
    if (!token) return res.status(200).json({ sent: false, reason: "auth_failed" });
    const authHeaders = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

    const dealerRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/dealers/${dealerUid}`,
      { headers: authHeaders }
    );
    if (!dealerRes.ok) return res.status(200).json({ sent: false, reason: "dealer_not_found" });
    const dealer = fromFirestoreFields((await dealerRes.json()).fields || {});

    const sendAttempts = [];
    if (dealer.whatsappNumber && dealer.whatsappApiKey) {
      sendAttempts.push(sendCallMeBot(dealer.whatsappNumber, dealer.whatsappApiKey, message));
    }

    // Every owner/manager/salesperson added under this dealer gets their own
    // alert too, if they've opted in with their own number.
    const teamRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "dealerTeam" }],
            where: { fieldFilter: { field: { fieldPath: "dealerUid" }, op: "EQUAL", value: { stringValue: dealerUid } } },
          },
        }),
      }
    );
    if (teamRes.ok) {
      const rows = await teamRes.json();
      rows.filter((r) => r.document).forEach((r) => {
        const member = fromFirestoreFields(r.document.fields || {});
        if (member.whatsappNumber && member.whatsappApiKey) {
          sendAttempts.push(sendCallMeBot(member.whatsappNumber, member.whatsappApiKey, message));
        }
      });
    }

    const results = await Promise.all(sendAttempts);
    const sentCount = results.filter(Boolean).length;
    return res.status(200).json({ sent: sentCount > 0, sentCount, attempted: sendAttempts.length });
  } catch (err) {
    // Never let a notification failure look like a site error to the visitor —
    // this endpoint is always called fire-and-forget after the real lead is
    // already safely saved.
    return res.status(200).json({ sent: false, reason: "error", detail: String(err) });
  }
};
