# ZA Auto Link — Site with Real Dealer Portal & Admin Dashboard 

Three files make up the whole site:
- `index.html` — public site: browse, sell, buy requests, and the dealer portal (apply/login/upload)
- `admin.html` — your private dashboard (not linked anywhere on the public site)
- `firebase-config.js` — shared settings both pages load

Behind the scenes it's backed by **Firebase** (free tier): Firestore for
data, Authentication for dealer and admin logins — and **Cloudinary** (also
free, no card required) for vehicle photos. Firebase's own Storage product
now requires a paid Blaze plan even for free-tier usage, so photos are kept
on Cloudinary instead to avoid that.

## 1. Create the Firebase project (~15 minutes, one-time)

1. Go to https://console.firebase.google.com → **Add project** → name it
   "ZA Auto Link" → you can skip Google Analytics → Create.
2. **Build → Firestore Database** → Create database → **production mode** →
   pick a region (e.g. `eur3`).
3. **Build → Authentication** → Get started → **Sign-in method** tab →
   enable **Email/Password**.
4. Gear icon (top left) → **Project settings** → scroll to "Your apps" →
   click the `</>` (web) icon → register an app (any nickname, skip
   Hosting) → copy the `firebaseConfig` object shown.
5. Paste those values into `firebase-config.js`:
   ```js
   const FIREBASE_CONFIG = {
     apiKey: "...",
     authDomain: "...",
     projectId: "...",
     storageBucket: "...",
     messagingSenderId: "...",
     appId: "...",
   };
   ```

## 2. Create your Cloudinary account (~5 minutes, one-time, free)

1. Go to https://cloudinary.com → sign up (no card needed).
2. On your Dashboard, copy your **Cloud Name** (shown near the top).
3. Go to **Settings** (gear icon) → **Upload** tab → scroll to "Upload
   presets" → **Add upload preset**.
4. Set **Signing Mode** to **Unsigned** (this lets the website upload
   directly without a server) → optionally set a "Max file size" (e.g. 6MB)
   and restrict "Allowed formats" to `jpg,png,webp` for safety → Save.
5. Copy the preset's name.
6. Paste both into `firebase-config.js`:
   ```js
   const CLOUDINARY_CLOUD_NAME = "your-cloud-name";
   const CLOUDINARY_UPLOAD_PRESET = "your-preset-name";
   ```

## 3. Set the Firestore security rules

This controls who can read/write what — without it, either nothing will
work, or (worse) anyone could write to your database.

- **Firestore Database → Rules** tab → replace everything with the contents
  of `firestore.rules` (included in this folder) → **Publish**.


## 3. Create your admin accounts (you + up to 3 teammates)

1. **Authentication → Users** tab → **Add user** → enter an email + password
   for yourself. Repeat for each teammate (up to 4 total accounts).
2. For each one, copy their **User UID** from that table (looks like
   `a1B2c3D4e5F6...`).
3. Go to **Firestore Database → Data** tab → **Start collection** → collection
   ID: `admins` → for the first document, set the **Document ID** to that
   exact UID, and add one field: `name` (string) = their name. Repeat for
   each teammate's UID as its own document in the same `admins` collection.

This is what grants access to `admin.html` — anyone who logs in with a
Firebase email/password account but whose UID isn't in `admins` will see a
"not authorized" screen instead of the dashboard.

## 4. What each part does

**Public site (`index.html`)**
- Browse Vehicles — pulls live from Firestore, shows only `status: approved`.
- Sell My Vehicle / Looking For Something Specific / vehicle enquiries — no
  login needed, save straight to Firestore, and also ping your email (via
  the existing Formspree endpoint) so you get notified instantly.
- Dealer Portal:
  - **Apply** creates a real account (Firebase Auth) plus a `dealers` record
    with `status: pending`.
  - Dealers can log in any time to check status, but the vehicle upload form
    only appears once you've approved them.
  - Once approved, they can upload a vehicle with 1–8 photos (picked from
    their device or computer — actual file upload, not a link). It's saved
    as `status: pending` until you approve it.

**Admin dashboard (`admin.html`)**
- Log in with one of the accounts you created in step 3.
- **Dealer Approvals** — approve or reject applications; approving is what
  unlocks their upload form.
- **Vehicle Approvals** — see every submitted vehicle, which dealer uploaded
  it, its photos, and approve/reject. Approved ones go live on the site
  immediately (real-time, no redeploy needed).
- **Sell Requests**, **Buy Requests**, **Buyer Enquiries** — each a running
  list with call buttons and status tracking (new → contacted → closed).
- **Add a Vehicle Yourself** — same photo-upload experience as a dealer, but
  publishes immediately as `approved` since you're adding it directly.

## 5. Deploy

Same as before — this is still just static files, no build step:

1. Unzip everything into one folder if you haven't already.
2. Drag the folder into https://vercel.com/new (or use
   https://app.netlify.com/drop) to deploy.
3. Once live, add your GoDaddy domain under the project's Domain settings
   and update your GoDaddy DNS as instructed.
4. Also add your live domain under **Firebase Console → Authentication →
   Settings → Authorized domains** — otherwise logins will be blocked from
   that domain.

## 6. Test before telling anyone it's live

- Open the site, apply as a test "dealer" with a throwaway email, confirm it
  shows up under **Dealer Approvals** in `admin.html`.
- Approve it, log back in as that dealer, upload a vehicle with a couple of
  photos, confirm it shows under **Vehicle Approvals**.
- Approve the vehicle, confirm it appears in **Browse Vehicles** on the
  public site.
- Submit a Sell request and a Buy request, confirm both the email arrives
  and the entries show up in the dashboard.

## Notes on cost & limits

Firebase's free "Spark" plan covers this comfortably at small scale (50k
reads/20k writes per day on Firestore) with no card required. Cloudinary's
free tier covers 25 monthly credits (roughly 25GB of combined storage and
bandwidth), also with no card required — plenty for vehicle photos at this
scale. If ZA Auto Link grows a lot, both platforms have paid tiers you can
move to later.

## 7. Set up Google Analytics (~5 minutes, free)

1. Go to https://analytics.google.com → create an account if you don't have
   one → create a **Property** for "ZA Auto Link" → choose **Web** as the
   platform → enter `https://zaautolink.co.za` as the website URL.
2. It'll show you a **Measurement ID** that looks like `G-ABC123XYZ0`.
3. Open `index.html`, find the two lines near the top of `<head>` that say
   `G-XXXXXXXXXX` and replace both with your real Measurement ID.
4. Redeploy. Give it a few hours — traffic shows up in the GA4 dashboard
   under **Reports → Realtime** almost immediately, other reports take a
   little longer to populate.

## 8. Turn on automatic Firestore backups (~5 minutes, free)

This is separate from anything in this repo — it's a setting inside Firebase
itself, so nothing to redeploy:

1. Firebase Console → **Firestore Database** → look for a **Backups** tab
   near the top (next to Data, Rules, Indexes).
2. Click **Create backup schedule**.
3. Pick daily or weekly, and how long to retain each backup (e.g. 7 or 30
   days) — daily with 30-day retention is a sensible default for this size
   of business.
4. Save. Firebase handles the rest automatically — no code, no maintenance.

If you ever need to restore, that same Backups tab lets you spin up a new
database from any saved backup point.

## What's new: Activity Log & How It Works

- **Activity Log** (in `admin.html`) — a running record of who approved,
  rejected, edited, or deleted what, and when. It's append-only: nobody,
  including admins, can edit or delete an entry once it's written, so it
  stays a trustworthy audit trail if you ever need to check "who did that?"
  with your team.
- **How It Works** (in `index.html`, in the main site navigation) — a trust
  page explaining the process for sellers, buyers, and dealers. Pure content
  — edit the text directly in the HTML under `data-section="howitworks"` any
  time your process changes.

## 9. Turn on WhatsApp lead alerts for dealers (~5 minutes, free)

Dealers can now get a free WhatsApp message the instant a customer enquires
about one of their vehicles — on top of the portal and email notifications
they already get. Each dealer opts in themselves from their own portal (Leads
tab), so there's nothing you need to do per-dealer. But the *site* itself
needs one one-time setup before any of it will actually send:

**Why this step exists:** a dealer's WhatsApp alert key is private — if it
leaked, someone could use it to spam that dealer. So, unlike everything else
in this project, sending it needs a Firebase *service account* (a private
admin credential) rather than the free public-read trick used everywhere
else. This is still 100% free — it's just a credential, not a paid API.

1. **Get the service account key:**
   Firebase Console → the gear icon (top left) → **Project settings** →
   **Service accounts** tab → **Generate new private key**. This downloads a
   `.json` file — keep it somewhere safe, never commit it to the repo or
   share it publicly.

2. **Add it to Vercel as 3 environment variables:**
   Open that downloaded JSON file. In your Vercel project → **Settings** →
   **Environment Variables**, add:
   - `FIREBASE_PROJECT_ID` — the `project_id` value from the JSON
   - `FIREBASE_CLIENT_EMAIL` — the `client_email` value from the JSON
   - `FIREBASE_PRIVATE_KEY` — the whole `private_key` value from the JSON,
     including the `-----BEGIN PRIVATE KEY-----` / `-----END PRIVATE KEY-----`
     lines. Paste it exactly as-is; Vercel handles the line breaks fine.

3. **Redeploy** (any small redeploy triggers Vercel to pick up the new
   environment variables — even just re-uploading the same files again).

That's it — no code changes needed. Until this is done, everything else on
the site works completely normally; the WhatsApp step just quietly does
nothing (dealers still get their leads by portal and email either way).

**A few honest caveats about the WhatsApp side specifically:**
- It uses [CallMeBot](https://www.callmebot.com/), a free, independently-run
  relay — not the official WhatsApp Business API, and not run by
  WhatsApp/Meta. It's been reliable for years but comes with no guarantee.
- Each dealer must personally do the WhatsApp opt-in step once (message a
  number, get a key back) before alerts work for them.
- If you outgrow this later, the official route is WhatsApp's own Business
  API (Meta Cloud API) — proper support, official guarantees, but requires a
  Meta Business account and paid message credits beyond a free monthly
  allowance. The trigger code (`api/notify-whatsapp.js`) is written so
  swapping the sending method later is a small, contained change.

