// ZA Auto Link — per-vehicle landing page.
// Renders a real, unique, crawlable HTML page for one vehicle so Google can
// index each car individually and links look good when shared on WhatsApp/
// Facebook (title, description, photo preview). Reads straight from Firestore
// via its public REST API — no service account, no extra cost, no extra
// dependency to install. A vehicle is only ever shown here if it's approved,
// same rule Firestore already enforces for public reads.

const PROJECT_ID = "za-auto-link";
const SITE_URL = "https://zaautolink.co.za";

// Converts one Firestore REST "fields" object into a plain JS object.
function parseFirestoreFields(fields) {
  const out = {};
  for (const key in fields) {
    out[key] = parseFirestoreValue(fields[key]);
  }
  return out;
}
function parseFirestoreValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return Number(v.doubleValue);
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.nullValue !== undefined) return null;
  if (v.arrayValue !== undefined) return (v.arrayValue.values || []).map(parseFirestoreValue);
  if (v.mapValue !== undefined) return parseFirestoreFields(v.mapValue.fields || {});
  return null;
}

function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function notFoundPage(res, message, alternatives) {
  const altHtml = (alternatives && alternatives.length)
    ? `<div style="text-align:left;max-width:640px;margin:32px auto 0;">
        <h2 style="font-size:16px;color:#0F1E30;">Similar vehicles available now</h2>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;">
          ${alternatives.map((a) => `
            <a href="${SITE_URL}/vehicle/${a.slug ? a.slug + "-" : ""}${a.id}" style="display:block;text-decoration:none;color:inherit;border:1px solid #E2E8F0;border-radius:10px;overflow:hidden;">
              <img src="${escapeHtml(a.image)}" style="width:100%;height:120px;object-fit:cover;display:block;">
              <div style="padding:10px;">
                <div style="font-weight:700;font-size:13px;color:#0F1E30;">${escapeHtml(a.title)}</div>
                <div style="font-size:13px;color:#0F1E30;font-weight:800;">R ${a.price.toLocaleString("en-ZA")}</div>
              </div>
            </a>`).join("")}
        </div>
      </div>` : "";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vehicle not found | ZA Auto Link</title>
<meta name="robots" content="noindex">
${alternatives && alternatives.length ? "" : `<meta http-equiv="refresh" content="3;url=${SITE_URL}/">`}
</head><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;padding:60px 20px;">
<h1 style="font-size:22px;color:#0F1E30;">${escapeHtml(message)}</h1>
<p style="color:#455A70;">This vehicle may have been sold or removed.</p>
<p><a href="${SITE_URL}/" style="color:#0F1E30;font-weight:700;">Browse all vehicles now &rarr;</a></p>
${altHtml}
</body></html>`);
}

async function findSimilarVehicles(excludeId, category) {
  try {
    const fsRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: "vehicles" }],
            where: {
              compositeFilter: {
                op: "AND",
                filters: [
                  { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "approved" } } },
                  { fieldFilter: { field: { fieldPath: "category" }, op: "EQUAL", value: { stringValue: category || "vehicles" } } },
                ],
              },
            },
            limit: 8,
          },
        }),
      }
    );
    if (!fsRes.ok) return [];
    const rows = await fsRes.json();
    return rows.filter((r) => r.document && r.document.name.split("/").pop() !== excludeId).slice(0, 4).map((r) => {
      const id = r.document.name.split("/").pop();
      const f = parseFirestoreFields(r.document.fields || {});
      return {
        id, title: `${f.year} ${f.make} ${f.model}`, price: Number(f.price || 0),
        image: (f.images && f.images[0]) || `${SITE_URL}/social-preview.jpg`,
        slug: slugify(`${f.year} ${f.make} ${f.model}`),
      };
    });
  } catch {
    return [];
  }
}

module.exports = async (req, res) => {
  const { id: rawId } = req.query;
  if (!rawId) return notFoundPage(res, "Vehicle not found");
  // The URL may be "2020-volkswagen-t-cross-abc123" (slug + real ID) or, for
  // older links, just "abc123" — the real Firestore ID is always the last
  // hyphen-separated segment, since slug words are joined by hyphens and the
  // ID itself never contains one.
  const parts = String(rawId).split("-");
  const id = parts[parts.length - 1];

  try {
    const fsRes = await fetch(
      `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/vehicles/${id}`
    );
    if (!fsRes.ok) return notFoundPage(res, "Vehicle not found");
    const doc = await fsRes.json();
    const v = parseFirestoreFields(doc.fields || {});

    if (v.status !== "approved") {
      const alternatives = await findSimilarVehicles(id, v.category || "vehicles");
      return notFoundPage(res, "This one's no longer available", alternatives);
    }

    const title = `${v.year} ${v.make} ${v.model} — R ${Number(v.price || 0).toLocaleString("en-ZA")} | ZA Auto Link`;
    const isRTO = v.listingType === "rto";
    const description = `${isRTO ? "Rent-to-Own" : "For sale"} ${v.year} ${v.make} ${v.model}${v.location ? " in " + v.location : ""} — ${Number(v.mileage || 0).toLocaleString("en-ZA")} km, ${v.fuel || ""} ${v.transmission || ""}. Verified dealer stock on ZA Auto Link, South Africa's trusted car middleman.`;
    const image = (v.images && v.images[0]) ? v.images[0] : `${SITE_URL}/social-preview.jpg`;
    const slug = slugify(`${v.year} ${v.make} ${v.model}`);
    const pageUrl = `${SITE_URL}/vehicle/${slug ? slug + "-" : ""}${encodeURIComponent(id)}`;
    const appUrl = `${SITE_URL}/?vehicle=${encodeURIComponent(id)}`;

    const featuresHtml = (v.features && v.features.length)
      ? `<ul>${v.features.map((f) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>` : "";

    // Structured data (schema.org) — this is what lets Google show price,
    // mileage, and condition directly in search results as a rich result,
    // rather than just a plain blue link.
    const schema = {
      "@context": "https://schema.org",
      "@type": "Vehicle",
      name: `${v.year} ${v.make} ${v.model}`,
      brand: { "@type": "Brand", name: v.make },
      model: v.model,
      vehicleModelDate: String(v.year || ""),
      mileageFromOdometer: { "@type": "QuantitativeValue", value: Number(v.mileage || 0), unitCode: "KMT" },
      fuelType: v.fuel || undefined,
      vehicleTransmission: v.transmission || undefined,
      image: image,
      description: description,
      url: pageUrl,
      offers: {
        "@type": "Offer",
        url: pageUrl,
        priceCurrency: "ZAR",
        price: Number(v.price || 0),
        availability: "https://schema.org/InStock",
        itemCondition: v.condition === "New" ? "https://schema.org/NewCondition" : "https://schema.org/UsedCondition",
        areaServed: v.location || "South Africa",
        seller: { "@type": "AutoDealer", name: v.dealerName || "ZA Auto Link" },
      },
    };

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400");
    res.status(200).send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="product">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:url" content="${pageUrl}">
<meta property="og:site_name" content="ZA Auto Link">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<!-- Real users get bounced straight into the live interactive site, modal
     already open on this vehicle. Search engines and link-preview bots
     don't execute this redirect, so they index the content below instead. -->
<meta http-equiv="refresh" content="0;url=${appUrl}">
<script>window.location.replace(${JSON.stringify(appUrl)});</script>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:640px;margin:40px auto;padding:0 20px;color:#0F1E30;}
  img{width:100%;border-radius:12px;}
  h1{font-size:22px;}
  .price{font-size:20px;font-weight:800;color:#0F1E30;margin:6px 0 16px;}
  a.btn{display:inline-block;background:#0F1E30;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;margin-top:16px;}
  ul{padding-left:18px;color:#455A70;}
</style>
</head>
<body>
  <img src="${escapeHtml(image)}" alt="${escapeHtml(v.year + ' ' + v.make + ' ' + v.model)}">
  <h1>${escapeHtml(v.year + " " + v.make + " " + v.model)}${isRTO ? " — Rent to Own" : ""}</h1>
  <div class="price">R ${Number(v.price || 0).toLocaleString("en-ZA")}</div>
  <p>${Number(v.mileage || 0).toLocaleString("en-ZA")} km &middot; ${escapeHtml(v.fuel || "")} &middot; ${escapeHtml(v.transmission || "")}${v.location ? " &middot; " + escapeHtml(v.location) : ""}</p>
  <p>${escapeHtml(v.description || "")}</p>
  ${featuresHtml}
  <a class="btn" href="${appUrl}">View full listing on ZA Auto Link &rarr;</a>
</body>
</html>`);
  } catch (err) {
    return notFoundPage(res, "Something went wrong loading this vehicle");
  }
};
