// ZA Auto Link — sitemap.xml, generated live from Firestore so every
// approved vehicle (and both browse tabs) gets discovered by Google without
// anyone having to remember to update a file by hand.

const PROJECT_ID = "za-auto-link";
const SITE_URL = "https://zaautolink.co.za";

// Kept in sync with api/cars/[...slug].js's own PROVINCES map — this is what
// lets us list only region/make-region combinations that actually have
// matching stock right now, so the sitemap never points Google at a thin or
// empty page.
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

function escapeXml(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));
}
function slugify(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function fsValue(v) {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  return "";
}
function regionForTown(town) {
  const t = (town || "").toLowerCase().trim();
  if (!t) return null;
  for (const region in PROVINCES) {
    if (PROVINCES[region].some((known) => t.includes(known) || known.includes(t))) return region;
  }
  return null;
}

module.exports = async (req, res) => {
  let vehicleUrls = [];
  let regionUrls = [];
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
              fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: { stringValue: "approved" } },
            },
          },
        }),
      }
    );
    if (fsRes.ok) {
      const rows = await fsRes.json();
      const regionCombos = new Set(); // "region" or "make/region" — dedup, only ones with real stock
      vehicleUrls = rows.filter((r) => r.document).map((r) => {
        const id = r.document.name.split("/").pop();
        const f = r.document.fields || {};
        const year = fsValue(f.year || {});
        const make = fsValue(f.make || {});
        const model = fsValue(f.model || {});
        const location = fsValue(f.location || {});
        const category = fsValue(f.category || {}) || "vehicles";
        if (category === "vehicles") {
          const region = regionForTown(location);
          if (region) {
            regionCombos.add(region);
            if (make) regionCombos.add(`${slugify(make)}/${region}`);
          }
        }
        const slug = slugify(`${year} ${make} ${model}`);
        return `${SITE_URL}/vehicle/${slug ? slug + "-" : ""}${id}`;
      });
      regionUrls = [...regionCombos].map((combo) => `${SITE_URL}/cars/${combo}`);
    }
  } catch {
    // If Firestore is briefly unreachable, still serve the static pages below
    // rather than a broken sitemap.
  }

  const staticUrls = [
    `${SITE_URL}/`,
    `${SITE_URL}/?tab=rto`,
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticUrls, ...regionUrls, ...vehicleUrls].map((u) => `  <url><loc>${escapeXml(u)}</loc></url>`).join("\n")}
</urlset>`;

  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=3600");
  res.status(200).send(xml);
};
