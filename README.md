# Zack Tarbet — webinar sign-up site

Static site that hosts the registration pages for Zack's live classes and webinars.
Built from the Sept 8 call with Zack: plain OriginPoint branding, no Heroes Home
Network, no "Zack, your mortgage guy", nothing cute. Sign-ups land on our own
domain instead of going straight to a Zoom link.

Three pages are live in the config today:

| Class | Audience | When |
|---|---|---|
| Financing Class for Compass Agents | Compass agents | Tue, Sep 22 2026, 10:00 AM MT |
| VA Home Loan Webinar | Veterans / active duty | Wed, Sep 23 2026, 10:00 AM MT |
| VA Loan Class for Real Estate Agents | General agents | Tue, Oct 13 2026, 10:00 AM MT |

---

## Launch checklist

The build tells you what is still missing. Run it and it prints every outstanding
placeholder:

```bash
npm run build
```

**Still outstanding — the Zoom links are the only config left:**

- [ ] **`<<ZOOM_REGISTRATION_URL_*>>`** — one Zoom registration link per class, in
      `data/webinars.json`. Until these are set, a registration still saves to
      GoHighLevel and the registrant lands on the thank-you page; they just are
      not handed off to Zoom, so GHL has to email them the link.
- [ ] **Point `tarbetmortgageteam.com`** at the deployment.
- [ ] **Send one test registration** once the Zoom links are in, and confirm it
      lands in *both* GoHighLevel and the Google Sheet (see below).
- [ ] **Have Zack read the class descriptions.** They are drafted, not approved.

**Done:**

- [x] NMLS disclosure — Zack (2040562) and OriginPoint (2185899), on every page
- [x] Work email and business phone
- [x] GoHighLevel inbound webhook
- [x] Time zone — **Mountain** (`America/Denver` / `MT`). All three classes are
      10:00 AM MT.
- [x] Domain set to `tarbetmortgageteam.com`

- [ ] **Swap in the real logo file.** `src/assets/logo.svg` is currently a
      *reproduction* of the Tarbet Mortgage Team wordmark, drawn to match the
      artwork so the site does not look unbranded. It uses a system bold sans,
      not the brand typeface, so the letterforms are close but not exact.
      Replace that file with the official artwork (`.svg` preferred, `.png`
      fine — point `logo.file` in `data/site.json` at it) and set
      `logo.isPlaceholder` to `false`. Nothing else changes; the build warning
      clears.

Optional but worth doing:

- [ ] Add a GA4 measurement ID in `data/site.json` → `analytics.ga4MeasurementId`.
- [ ] Add a social share image. There is no `og:image` yet, so Facebook and text
      previews show plain text. A 1200×630 PNG at `src/assets/og-default.png`
      plus an `og:image` tag in `src/templates/base.html` fixes it.

---

## Editing and adding classes

All content is in `data/webinars.json`. One object per class. To add the next
month's session, copy an existing block and change the `slug`, `title`, and
`startsAt`. The home page, sitemap, calendar files, and SEO tags all update on
the next build.

Fields that matter:

| Field | What it does |
|---|---|
| `slug` | The URL: `/webinars/<slug>/`. Keep it short, it goes in texts and emails. |
| `status` | Set to `"draft"` to build the site without this class showing up. |
| `startsAt` | ISO timestamp **with offset**, e.g. `2026-10-13T10:00:00-06:00`. Mind daylight saving: Mountain is `-06:00` (MDT) through Nov 1 2026, then `-07:00` (MST). Get this wrong and the class shows an hour off everywhere. |
| `durationMinutes` | Drives the end time on the calendar invite. |
| `zoomRegistrationUrl` | Where registrants go after the form submits. |
| `learnPoints` / `forWho` | The two bulleted lists on the page. |
| `extraField` | The one audience-specific question (brokerage, service status). Set to `null` to drop it. |

Past classes are handled automatically: once the end time passes, the page shows
a "this already happened, register for the recording" notice and the home page
card greys out. Leave old classes in the file — those pages keep collecting leads
from links already out in the world.

---

## Where leads go

Every registration is posted to **all** the destinations in `data/site.json` →
`lead.destinations`, with the identical JSON payload. Today that is two places:

| Destination | Required | Why |
|---|---|---|
| GoHighLevel | yes | The CRM. Sends the confirmation email, the Zoom link, and reminders. |
| Google Sheet (Apps Script) | no | A running record of every signup. |

"Required" only controls what happens to the *registrant* when a destination
fails. A required failure with no Zoom link configured shows an error and lets
them retry. A non-required failure is logged to the browser console and the
registrant never sees it — a broken spreadsheet must never cost a signup.

Both are still awaited before the redirect, and both requests are sent with
`keepalive`, so navigating to Zoom does not cancel an in-flight post. A
destination that hangs is given 8 seconds before the redirect proceeds without
it; `keepalive` means the request usually still lands.

To add a destination, add an object to the array. Nothing else changes:

```json
{ "name": "Zapier", "url": "https://hooks.zapier.com/...", "required": false }
```

### The payload

```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@example.com",
  "phone": "7195551234",
  "service_status": "Veteran",
  "consent": true,
  "webinar_slug": "va-home-loan-webinar",
  "webinar_title": "VA Home Loan Webinar",
  "webinar_starts_at": "2026-09-23T16:00:00.000Z",
  "page_url": "https://tarbetmortgageteam.com/webinars/va-home-loan-webinar/",
  "referrer": "",
  "submitted_at": "2026-09-15T20:18:39.180Z",
  "utm_source": "facebook",
  "utm_campaign": "va_sept"
}
```

The audience-specific field varies by class: `service_status` on the veteran
webinar, `brokerage` on the two agent classes. `utm_*`, `fbclid` and `gclid` are
passed through from the link, so the Facebook group post, the email blast, and
Stefan's call list can each be tagged and counted separately:

```
https://tarbetmortgageteam.com/webinars/va-home-loan-webinar/?utm_source=facebook&utm_medium=group&utm_campaign=va_sept
```

### Why the Sheet post uses text/plain

Apps Script web apps do not answer the CORS preflight (`OPTIONS`) that a
`Content-Type: application/json` POST triggers, so the browser would block the
request before sending it. Posting as `text/plain;charset=utf-8` keeps it a CORS
"simple request", which needs no preflight. **The body is still JSON** — read it
with `JSON.parse(e.postData.contents)`, not `e.parameter`.

That is what `contentType` in the destination config controls. Do not change it
to `application/json` for an Apps Script endpoint.

### What the Apps Script needs to look like

The endpoint was supplied already deployed, so this was not verified against it
— if rows are not appearing, compare it against this:

```js
function doPost(e) {
  var data = JSON.parse(e.postData.contents);
  var sheet = SpreadsheetApp.openById('YOUR_SHEET_ID').getSheetByName('Registrations');

  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Received', 'First', 'Last', 'Email', 'Phone', 'Brokerage / service status',
      'Consent', 'Class', 'Class date', 'Source', 'Campaign', 'Page'
    ]);
  }

  sheet.appendRow([
    new Date(),
    data.first_name || '',
    data.last_name || '',
    data.email || '',
    "'" + (data.phone || ''),            // leading quote keeps the leading digits
    data.brokerage || data.service_status || '',
    data.consent ? 'Yes' : 'No',
    data.webinar_title || '',
    data.webinar_starts_at || '',
    data.utm_source || '',
    data.utm_campaign || '',
    data.page_url || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

Two deployment settings matter, or every post fails silently:

- **Execute as:** Me
- **Who has access:** Anyone

Re-deploying an Apps Script issues a **new `/exec` URL** unless you deploy over
the existing version. If you create a new deployment, update the URL in
`data/site.json`.

### Before launch

Submit one real registration on the live site and confirm it lands in **both**
places — a row in the Sheet and a contact in GoHighLevel. That also lets GHL
capture the payload so you can map the fields onto the contact record.

**One thing to know about the URLs.** Because the form posts from the visitor's
browser, both destination URLs are visible in the page source. That is normal —
GoHighLevel's own embedded forms work the same way — but it means someone could
POST junk directly. The honeypot stops ordinary form-filling bots; it cannot
stop someone deliberately hitting the endpoint.

If that becomes a problem: add required-field and email validation inside the
GHL workflow and the Apps Script so junk never creates a contact or a row;
rotate the URLs (both are one line in `data/site.json`); or move the posts behind
a serverless function so neither URL reaches the browser. Not worth doing
pre-emptively — just know which lever to pull.

## How the registration pages are laid out

Each class page is one template (`src/templates/webinar.html`), driven entirely
by its entry in `data/webinars.json`. Nothing is per-page hand-built, so a new
class gets the same design for free.

- **Navy hero** with the class title, a live countdown, and four at-a-glance
  chips (date, time, where, cost). The form card sits beside it and dips into
  the white section below.
- **Countdown** ticks every 30 seconds and switches to "this session has
  started" at go time.
- **Numbered topic cards** built from `learnPoints` — the count in the kicker
  ("6 things we go through") is derived, so it stays right when you edit the
  list.
- **Who it is for** from `forWho`, and a host panel that shows `loanOfficer.photo`
  if you set one and falls back to initials if you do not.
- **Sticky bar** slides up once the form scrolls fully out of view, and hides
  again when it comes back. Every "Save my seat" link scrolls to the form and
  focuses the first field rather than just jumping the hash.

Two deliberate omissions: there are no attendee counts, "only X seats left"
banners, or testimonials anywhere. Those would have to be invented, and this is
a regulated industry. If Zack wants to cap the agent classes at 20 as he
described, enforce it in Zoom or GoHighLevel — the page should not claim a limit
it is not tracking.

Hero text was checked against WCAG AA contrast; all of it passes at its rendered
size. Worth re-checking if you change `--brand-navy` or `--brand-accent`.

## The logo

`data/site.json` → `logo` controls it:

```json
"logo": { "file": "logo.svg", "alt": "Tarbet Mortgage Team", "heightPx": 58 }
```

The file lives in `src/assets/`. It renders in the masthead at `heightPx`, and
again in the footer at 85% of that. Set `file` to `""` and the site falls back
to a plain text wordmark — nothing breaks.

The footer is dark navy and the logo is navy, so the footer copy is reversed to
white with a CSS filter. That works because the mark is a single colour. **If a
multi-colour version ever replaces it, that filter needs to go** and a properly
reversed file should be supplied instead — see `.footer__logo` in
`src/assets/styles.css`.

The favicon (`src/assets/favicon.svg`) is a T over a star, echoing the wordmark.

One thing worth a look: the site uses a muted gold accent (`--brand-accent` in
`styles.css`) for eyebrow text, checkmarks, and the countdown. The supplied logo
is monochrome navy, so that accent is a choice rather than a brand colour. If
there is an official secondary colour, it is a one-line change at the top of the
stylesheet.

## Running it

```bash
npm run build     # build into dist/
npm run dev       # build, then preview at http://localhost:8080
npm run check     # build and exit non-zero if placeholders remain (for CI)
```

No dependencies, no install step. Node 18 or newer.

## Deploying

`vercel.json` and `netlify.toml` are both included — import the repo and it
builds with no further setup. Build command `node build.mjs`, output directory
`dist`.

For any other host (including a plain S3 bucket or cPanel), run `npm run build`
and upload the contents of `dist/`. It is all static files.

## How it is put together

```
data/site.json        global settings: branding, NMLS, time zone, webhook, legal
data/webinars.json    one entry per class — this is what you actually edit
src/templates/        page shells
src/assets/           styles.css, app.js, logo.svg, favicon.svg
build.mjs             generates dist/ from the above
dist/                 build output, committed so the site can be served as-is
```

`build.mjs` also generates, per class, an `Event` JSON-LD block for search
results, an `.ics` calendar file, a Google Calendar link, and an entry in
`sitemap.xml`.

The site is one navy, one accent colour, and system fonts — no webfont requests,
no tracking beyond the analytics ID you supply, no external JavaScript. It loads
fast on a phone on base wifi, which is most of this audience.

## Notes on what was decided

- **Branding** is plain per Zack: "very cut and dry", OriginPoint only. No Heroes
  Home Network, no "all 50 states", no NMLS-cookie-cutter styling.
- **Time zone** is Mountain, confirmed by Colin. The 719 area code on Zack's
  business line matches.
- **Dates** are read from the call: Compass on the 22nd, the consumer webinar on
  the 23rd, and the general agent class on a Tuesday in the week of the 12th–16th,
  which is Oct 13. (Fathom's auto-generated action items said "Sep 15" for the
  agent class, which does not line up with Zack being in Utah the 6th–9th first.
  Worth a one-line confirmation.)
- **Class size**: Zack wants 12–20 agents, intentionally intimate. There is no
  registration cap in the form — if you want one, it needs to be enforced in Zoom
  or GHL, not here.
