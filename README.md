# Zack Tarbet — webinar sign-up site

Static site that hosts the registration pages for Zack's live classes and webinars.
Built from the Sept 8 call with Zack: plain OriginPoint branding, no Heroes Home
Network, no "Zack, your mortgage guy", nothing cute. Sign-ups land on our own
domain instead of going straight to a Zoom link.

Three pages are live in the config today:

| Class | Audience | When |
|---|---|---|
| Financing Class for Compass Agents | Compass agents | Tue, Sep 22 2026, 10:00 AM |
| VA Home Loan Webinar | Veterans / active duty | Wed, Sep 23 2026, 10:00 AM |
| VA Loan Class for Real Estate Agents | General agents | Tue, Oct 13 2026, 10:00 AM |

---

## Launch checklist

The build tells you what is still missing. Run it and it prints every outstanding
placeholder:

```bash
npm run build
```

Everything below has to be filled in before this goes live. All of it lives in
`data/site.json` and `data/webinars.json` — no code changes needed.

- [ ] **`<<ZACK_NMLS_ID>>`** — Zack's individual NMLS number. Required on the page by law.
- [ ] **`<<ORIGINPOINT_NMLS_ID>>`** — OriginPoint's company NMLS number.
- [ ] **`<<ZACK_WORK_EMAIL>>`** — the OriginPoint address, not the Gmail.
- [ ] **`<<ZACK_BUSINESS_PHONE>>`** — the Google My Business number.
- [ ] **`<<GOHIGHLEVEL_INBOUND_WEBHOOK_URL>>`** — see *Wiring up GoHighLevel* below.
- [ ] **`<<ZOOM_REGISTRATION_URL_*>>`** — one Zoom registration link per class.
- [ ] **Confirm the time zone.** `data/site.json` currently says `America/New_York` / `ET`.
      This was a guess — it never came up on the call. If Zack runs these on Mountain
      or Pacific, change `timeZone` and `timeZoneLabel` and rebuild. Everything
      (page copy, calendar files, countdown) follows from that one setting.
- [ ] **Point the domain** at the deployment (`tarbetmortgageteam.com` per the call —
      confirm which of the two domains was actually bought, and update `baseUrl`).
- [ ] **Have Zack read the class descriptions.** They are drafted, not approved.

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
| `startsAt` | ISO timestamp **with offset**, e.g. `2026-10-13T10:00:00-04:00`. Mind daylight saving: `-04:00` through early November, `-05:00` after. |
| `durationMinutes` | Drives the end time on the calendar invite. |
| `zoomRegistrationUrl` | Where registrants go after the form submits. |
| `learnPoints` / `forWho` | The two bulleted lists on the page. |
| `extraField` | The one audience-specific question (brokerage, service status). Set to `null` to drop it. |

Past classes are handled automatically: once the end time passes, the page shows
a "this already happened, register for the recording" notice and the home page
card greys out. Leave old classes in the file — those pages keep collecting leads
from links already out in the world.

---

## Wiring up GoHighLevel

The registration form posts JSON to whatever URL is in `site.json` → `lead.webhookUrl`.

1. In GoHighLevel: **Automation → Workflows → Create Workflow → Inbound Webhook** trigger.
2. Copy the webhook URL into `data/site.json`.
3. Submit one test registration so GHL captures the payload shape, then map the
   fields onto the contact record.
4. Add the follow-up actions to the workflow: confirmation email with the Zoom
   link, a reminder the day before, and one the morning of.

The payload looks like this:

```json
{
  "first_name": "Jane",
  "last_name": "Doe",
  "email": "jane@example.com",
  "phone": "5551234567",
  "service_status": "Veteran",
  "consent": true,
  "webinar_slug": "va-home-loan-webinar",
  "webinar_title": "VA Home Loan Webinar",
  "webinar_starts_at": "2026-09-23T14:00:00.000Z",
  "page_url": "https://tarbetmortgageteam.com/webinars/va-home-loan-webinar/",
  "referrer": "",
  "submitted_at": "2026-09-11T17:57:09.552Z",
  "utm_source": "facebook",
  "utm_campaign": "va_class_oct"
}
```

`utm_*`, `fbclid`, and `gclid` are passed straight through from the link, so the
Facebook group post, the email blast to the 2,000 past registrants, and Stefan's
call list can each carry their own tag and be counted separately. Tag your links:

```
https://tarbetmortgageteam.com/webinars/va-home-loan-webinar/?utm_source=facebook&utm_medium=group&utm_campaign=va_sept
```

**Failure behaviour is deliberate.** If GoHighLevel is down or returns an error,
the registrant is still forwarded to the Zoom registration page rather than
shown an error. We would rather lose the CRM record than the attendee. If no
webhook is configured at all, the form validates and then hands off to Zoom, so
the pages work before GHL is set up.

There is a hidden honeypot field. Bots that fill it get a thank-you page and
nothing reaches the CRM.

---

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
src/assets/           styles.css, app.js, favicon
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
- **Dates** are read from the call: Compass on the 22nd, the consumer webinar on
  the 23rd, and the general agent class on a Tuesday in the week of the 12th–16th,
  which is Oct 13. (Fathom's auto-generated action items said "Sep 15" for the
  agent class, which does not line up with Zack being in Utah the 6th–9th first.
  Worth a one-line confirmation.)
- **Class size**: Zack wants 12–20 agents, intentionally intimate. There is no
  registration cap in the form — if you want one, it needs to be enforced in Zoom
  or GHL, not here.
