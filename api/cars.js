// ZA Auto Link — programmatic regional/make/model landing pages.
// URL shapes (all optional combinations, matched by segment count):
//   /cars/klerksdorp                    -> region only
//   /cars/volkswagen/klerksdorp         -> make + region
//   /cars/volkswagen/polo/north-west    -> make + model + region
// These exist purely for local search intent ("Polo North West") that a
// generic homepage or a single "Browse Vehicles" tab can't target — Google
// ranks specific landing pages, not just homepages. Real visitors get
// bounced into the live filtered app the same way vehicle pages work;
// crawlers see fully-rendered content with real listings.

const PROJECT_ID = "za-auto-link";
const SITE_URL = "https://zaautolink.co.za";

// Curated so a "North West" search matches stock in any of that province's
// towns, not just ones typed exactly as "North West" — dealers enter their
// own town freely, so this is deliberately generous rather than exact-match
// only. Extend this list as ZA Auto Link's dealer footprint grows.
const PROVINCES = {
  "north-west": ["klerksdorp", "potchefstroom", "rustenburg", "mahikeng", "mafikeng", "vryburg", "brits", "lichtenburg", "north west"],
  "gauteng": ["johannesburg", "pretoria", "sandton", "centurion", "midrand", "soweto", "krugersdorp", "vanderbijlpark", "vereeniging", "gauteng"],
  "western-cape": ["cape town", "stellenbosch", "paarl", "george", "worcester", "western cape"],
  "kwazulu-natal": ["durban", "pietermaritzburg", "newcastle", "richards bay", "kwazulu-natal", "kzn"],
  "eastern-cape": ["port elizabeth", "gqeberha", "east london", "uitenhage", "eastern cape"],
  "free-state": ["bloemfontein", "welkom", "bethlehem", "free state"],
  "limpopo": ["polokwane", "tzaneen", "mokopane", "limpopo"],
  "mpumalanga": ["nelspruit", "mbombela", "witbank", "emalahleni", "secunda", "mpumalanga"],
  "northern-cape": ["kimberley", "upington", "northern cape"],
};

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function titleCase(slug) {
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
function parseFirestoreFields(fields) {
  const out = {};
  for (const key in fields) out[key] = parseFirestoreValue(fields[key]);
  return out;
}
function parseFirestoreValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(parseFirestoreValue);
  if (v.mapValue !== undefined) return parseFirestoreFields(v.mapValue.fields || {});
  return null;
}

module.exports = async (req, res) => {
  // Plain named query params, not a bracketed catch-all filename — a
  // filename like [...slug].js uses characters that some Windows zip/unzip
  // and drag-and-drop flows can mangle, which silently breaks the whole
  // route. Ordinary query params on an ordinary filename can't fail that way.
  const make = req.query.make ? decodeURIComponent(String(req.query.make)).toLowerCase() : null;
  const model = req.query.model ? decodeURIComponent(String(req.query.model)).toLowerCase() : null;
  const region = req.query.region ? decodeURIComponent(String(req.query.region)).toLowerCase() : null;
  const segments = [make, model, region].filter(Boolean);
  if (!region) { res.writeHead(302, { Location: `${SITE_URL}/` }); return res.end(); }

  const regionTowns = PROVINCES[region] || [region.replace(/-/g, " ")];
  const regionLabel = PROVINCES[region] ? titleCase(region) : titleCase(region);

  let matches = [];
  try {
    // Single equality filter (category) keeps this index-free — make/model/
    // region are all matched in plain JS below, which also lets us do
    // case-insensitive and partial-town matching that Firestore queries
    // can't do on their own.
    const fsRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "vehicles" }],
            where: { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "approved" } } },
            limit: 500,
          },
        }),
      }
    );
    if (fsRes.ok) {
      const rows = await fsRes.json();
      matches = rows.filter((r) => r.document).map((r) => {
        const id = r.document.name.split("/").pop();
        const f = parseFirestoreFields(r.document.fields || {});
        return { id, ...f };
      }).filter((v) => {
        if ((v.category || "vehicles") !== "vehicles") return false;
        if (make && (v.make || "").toLowerCase() !== make.replace(/-/g, " ")) return false;
        if (model && !(v.model || "").toLowerCase().includes(model.replace(/-/g, " "))) return false;
        const loc = (v.location || "").toLowerCase().trim();
        return regionTowns.some((t) => loc.includes(t) || t.includes(loc));
      });
    }
  } catch {
    // Firestore hiccup — still render the page shell below rather than error out.
  }

  const makeLabel = make ? titleCase(make) : "";
  const modelLabel = model ? titleCase(model) : "";
  const vehicleWord = [makeLabel, modelLabel].filter(Boolean).join(" ") || "Vehicles";
  const title = `Used ${vehicleWord} for Sale in ${regionLabel} | ZA Auto Link`;
  const canonicalUrl = `${SITE_URL}/cars/${segments.join("/")}`;
  const appUrl = `${SITE_URL}/?tab=browse${make ? "&make=" + encodeURIComponent(makeLabel) : ""}${region ? "&loc=" + encodeURIComponent(regionLabel) : ""}`;

  const prices = matches.map((v) => Number(v.price || 0)).filter(Boolean);
  const priceLine = prices.length
    ? `Prices currently range from R ${Math.min(...prices).toLocaleString("en-ZA")} to R ${Math.max(...prices).toLocaleString("en-ZA")}.`
    : "";
  const introText = `Looking for a ${vehicleWord.toLowerCase()} in ${regionLabel}? ZA Auto Link connects you with verified, vetted dealerships across ${regionLabel === "North West" ? "North West and the wider Klerksdorp area" : regionLabel} — no time-wasters, no back-and-forth haggling. ${matches.length ? `We currently have ${matches.length} ${vehicleWord.toLowerCase()} listing${matches.length === 1 ? "" : "s"} live from local dealers.` : `New stock is added regularly — check back soon, or browse everything we currently have available.`} ${priceLine} Every dealer on ZA Auto Link is reviewed before their stock goes live, so you're browsing real, available vehicles from real local businesses.`;

  const cardsHtml = matches.slice(0, 24).map((v) => {
    const vSlug = slugify(`${v.year} ${v.make} ${v.model}`);
    const img = (v.images && v.images[0]) || `${SITE_URL}/social-preview.jpg`;
    return `<a href="${SITE_URL}/vehicle/${vSlug ? vSlug + "-" : ""}${v.id}" style="display:block;text-decoration:none;color:inherit;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
      <img src="${escapeHtml(img)}" style="width:100%;height:140px;object-fit:cover;display:block;" alt="${escapeHtml(v.year + ' ' + v.make + ' ' + v.model)}">
      <div style="padding:10px;">
        <div style="font-weight:700;font-size:14px;color:#0F1E30;">${escapeHtml(v.year + " " + v.make + " " + v.model)}</div>
        <div style="font-size:13px;color:#0F1E30;font-weight:800;">R ${Number(v.price || 0).toLocaleString("en-ZA")}</div>
        <div style="font-size:12px;color:#455A70;">${Number(v.mileage || 0).toLocaleString("en-ZA")} km &middot; ${escapeHtml(v.location || "")}</div>
      </div>
    </a>`;
  }).join("");

  // Thin/empty combination pages are worth keeping navigable for a curious
  // visitor, but shouldn't be indexed — Google can penalize sites that
  // generate large numbers of near-empty "search result as page" URLs.
  const shouldIndex = matches.length > 0;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=600, s-maxage=3600, stale-while-revalidate=86400");
  res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(introText.slice(0, 155))}">
<link rel="canonical" href="${canonicalUrl}">
<meta name="robots" content="${shouldIndex ? "index,follow" : "noindex,follow"}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(introText.slice(0, 155))}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:site_name" content="ZA Auto Link">
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#0F1E30;}
  h1{font-size:24px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin-top:20px;}
  a.btn{display:inline-block;background:#0F1E30;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;margin-top:20px;}
  p{color:#455A70;line-height:1.6;}
</style>
</head>
<body>
  <h1>Used ${escapeHtml(vehicleWord)} for Sale in ${escapeHtml(regionLabel)}</h1>
  <p>${escapeHtml(introText)}</p>
  ${cardsHtml ? `<div class="grid">${cardsHtml}</div>` : ""}
  <a class="btn" href="${appUrl}">View live results on ZA Auto Link &rarr;</a>
</body>
</html>`);
};
