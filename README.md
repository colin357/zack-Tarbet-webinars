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
- [ ] **Send one test registration** once the Zoom links are in, so GoHighLevel
      captures the payload and you can map the fields (see below).
- [ ] **Have Zack read the class descriptions.** They are drafted, not approved.

**Done:**

- [x] NMLS disclosure — Zack (2040562) and OriginPoint (2185899), on every page
- [x] Work email and business phone
- [x] GoHighLevel inbound webhook
- [x] Time zone — **Mountain** (`America/Denver` / `MT`). All three classes are
      10:00 AM MT.
- [x] Domain set to `tarbetmortgageteam.com`

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
  "phone": "7195551234",
  "service_status": "Veteran",
  "consent": true,
  "webinar_slug": "va-home-loan-webinar",
  "webinar_title": "VA Home Loan Webinar",
  "webinar_starts_at": "2026-09-23T16:00:00.000Z",
  "page_url": "https://tarbetmortgageteam.com/webinars/va-home-loan-webinar/",
  "referrer": "",
  "submitted_at": "2026-09-11T18:04:00.000Z",
  "utm_source": "facebook",
  "utm_campaign": "va_sept"
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

**One thing to know about the webhook URL.** Because the form posts straight from
the visitor's browser, the webhook URL is visible in the page source. That is
normal — GoHighLevel's own embedded forms work the same way — but it does mean
someone could POST junk to it directly. The honeypot stops ordinary bots that
crawl and fill forms; it cannot stop someone deliberately hitting the endpoint.

If that becomes a problem, the options in order of effort are: add required-field
and email-validation filters inside the GHL workflow so junk never creates a
contact; rotate the webhook URL (it is one line in `data/site.json`); or move the
POST behind a serverless function so the URL never reaches the browser. Not worth
doing pre-emptively — just know which lever to pull.

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
