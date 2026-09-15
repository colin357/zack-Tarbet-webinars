#!/usr/bin/env node
/**
 * Static site generator for the Tarbet Mortgage Team webinar site.
 *
 * No dependencies. Reads data/site.json + data/webinars.json, renders the
 * templates in src/templates, and writes a deployable site to dist/.
 *
 *   node build.mjs            build into dist/
 *   node build.mjs --check    build, and exit non-zero if placeholders remain
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const CHECK_MODE = process.argv.includes('--check');

const PLACEHOLDER_RE = /<<([A-Z0-9_]+)>>/g;
// Separate non-global copy: `.test()` on a /g regex is stateful and would
// return alternating answers for the same input.
const PLACEHOLDER_TEST_RE = /<<[A-Z0-9_]+>>/;
const placeholders = new Map(); // name -> Set of locations

/* ------------------------------------------------------------------ utils */

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => JSON.parse(read(p));

function write(relPath, contents) {
  const full = path.join(DIST, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Record every <<PLACEHOLDER>> so the build can report what is unfilled. */
function scanPlaceholders(value, location) {
  if (typeof value === 'string') {
    for (const m of value.matchAll(PLACEHOLDER_RE)) {
      if (!placeholders.has(m[1])) placeholders.set(m[1], new Set());
      placeholders.get(m[1]).add(location);
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => scanPlaceholders(v, `${location}[${i}]`));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) scanPlaceholders(v, `${location}.${k}`);
  }
}

/** True when a config value is missing or still a placeholder. */
const unset = (v) => !v || PLACEHOLDER_TEST_RE.test(String(v));

/** Renders {{ key }} (escaped) and {{{ key }}} (raw). Unknown keys become ''. */
function render(template, vars) {
  return template
    .replace(/\{\{\{\s*([\w.]+)\s*\}\}\}/g, (_, key) => String(lookup(vars, key) ?? ''))
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => esc(lookup(vars, key)));
}

function lookup(vars, dotted) {
  return dotted.split('.').reduce((acc, k) => (acc == null ? acc : acc[k]), vars);
}

function hash(contents) {
  return crypto.createHash('sha256').update(contents).digest('hex').slice(0, 8);
}

/* ------------------------------------------------------------- date helpers */

function fmt(date, opts, timeZone) {
  return new Intl.DateTimeFormat('en-US', { timeZone, ...opts }).format(date);
}

/** UTC timestamp in the compact form iCalendar and Google Calendar expect. */
function stamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function deriveDates(webinar, site) {
  const tz = site.timeZone;
  const start = new Date(webinar.startsAt);
  if (Number.isNaN(start.getTime())) {
    throw new Error(`Invalid startsAt "${webinar.startsAt}" for webinar "${webinar.slug}"`);
  }
  const end = new Date(start.getTime() + (webinar.durationMinutes || 45) * 60000);

  return {
    start,
    end,
    isPast: end.getTime() < Date.now(),
    weekday: fmt(start, { weekday: 'long' }, tz),
    dateLong: fmt(start, { month: 'long', day: 'numeric', year: 'numeric' }, tz),
    dateShort: fmt(start, { month: 'short', day: 'numeric' }, tz),
    dateMedium: fmt(start, { weekday: 'short', month: 'short', day: 'numeric' }, tz),
    timeShort: fmt(start, { hour: 'numeric', minute: '2-digit' }, tz),
  };
}

/** E.164 form for tel: links, so tapping the number dials correctly on mobile. */
function telHref(raw) {
  const d = String(raw).replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return `+${d}`;
}

/* --------------------------------------------------------------------- icons */

/** Inline stroke icons. currentColor so they inherit whatever they sit on. */
const ICONS = {
  calendar:
    '<path d="M7 3v3M17 3v3M3.5 9h17M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V7A1.5 1.5 0 0 1 5 5.5Z"/>',
  clock: '<path d="M12 7v5l3.5 2"/><circle cx="12" cy="12" r="8.5"/>',
  video: '<path d="M15 10.5 20.5 7v10L15 13.5M4.5 6.5h9A1.5 1.5 0 0 1 15 8v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 3 16V8a1.5 1.5 0 0 1 1.5-1.5Z"/>',
  ticket:
    '<path d="M3.5 9.5V7A1.5 1.5 0 0 1 5 5.5h14A1.5 1.5 0 0 1 20.5 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17v-2.5a2.5 2.5 0 0 0 0-5Z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7"/>',
  user: '<circle cx="12" cy="8" r="3.75"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  spark: '<path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4 10.1 12.8 4.5 10.9 10.1 9Z"/>',
};

/** Wraps an icon path in a sized <svg>. */
function icon(name, cls = 'icon') {
  return (
    `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `${ICONS[name] || ''}</svg>`
  );
}

/* --------------------------------------------------------------- fragments */

function listItems(items, className = '') {
  return items
    .map((item) => `<li${className ? ` class="${className}"` : ''}>${esc(item)}</li>`)
    .join('\n          ');
}

/** The "what this covers" list, as numbered cards. */
function topicCards(items) {
  return items
    .map(
      (item, i) => `<li class="topic">
            <span class="topic__num">${String(i + 1).padStart(2, '0')}</span>
            <span class="topic__text">${esc(item)}</span>
          </li>`
    )
    .join('\n          ');
}

/** The "who it is for" list, as check-marked cards. */
function audienceCards(items) {
  return items
    .map(
      (item) => `<li class="who">
            <span class="who__icon">${icon('check')}</span>
            <span>${esc(item)}</span>
          </li>`
    )
    .join('\n          ');
}

/** The at-a-glance row under the hero headline. */
function factChips(parts) {
  return parts
    .map(
      (p) => `<li class="chip">
            <span class="chip__icon">${icon(p.icon)}</span>
            <span class="chip__body"><span class="chip__label">${esc(p.label)}</span>${p.value}</span>
          </li>`
    )
    .join('\n          ');
}

/** Falls back to initials when there is no headshot in the config. */
function initials(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');
}

/**
 * Escapes a value for an iCalendar TEXT property (RFC 5545 section 3.3.11).
 * Backslashes must be escaped first, or later escapes get double-escaped.
 */
function escapeIcsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function buildIcs(webinar, site, dates) {
  const url = `${site.baseUrl.replace(/\/$/, '')}/webinars/${webinar.slug}/`;
  const lo = site.loanOfficer;
  const descLines = [
    webinar.summary,
    '',
    ...webinar.learnPoints.map((p) => `- ${p}`),
    '',
    `Hosted by ${lo.name}, ${lo.title}, ${lo.company}.`,
    `Details and Zoom link: ${url}`,
  ];
  const description = escapeIcsText(descLines.join('\n'));

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Tarbet Mortgage Team//Webinars//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${webinar.slug}@${new URL(site.baseUrl).hostname}`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(dates.start)}`,
    `DTEND:${stamp(dates.end)}`,
    `SUMMARY:${escapeIcsText(webinar.title)}`,
    `DESCRIPTION:${description}`,
    `LOCATION:${escapeIcsText(webinar.location || 'Live on Zoom')}`,
    `URL:${url}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  // Fold lines at 75 octets per RFC 5545.
  return lines
    .map((line) => {
      if (line.length <= 75) return line;
      const chunks = [line.slice(0, 75)];
      for (let i = 75; i < line.length; i += 74) chunks.push(' ' + line.slice(i, i + 74));
      return chunks.join('\r\n');
    })
    .join('\r\n') + '\r\n';
}

function googleCalendarUrl(webinar, site, dates) {
  const url = `${site.baseUrl.replace(/\/$/, '')}/webinars/${webinar.slug}/`;
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: webinar.title,
    dates: `${stamp(dates.start)}/${stamp(dates.end)}`,
    details: `${webinar.summary}\n\nDetails and Zoom link: ${url}`,
    location: webinar.location || 'Live on Zoom',
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function eventJsonLd(webinar, site, dates) {
  const url = `${site.baseUrl.replace(/\/$/, '')}/webinars/${webinar.slug}/`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Event',
    name: webinar.title,
    description: webinar.seoDescription || webinar.summary,
    startDate: dates.start.toISOString(),
    endDate: dates.end.toISOString(),
    eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
    eventStatus: 'https://schema.org/EventScheduled',
    location: { '@type': 'VirtualLocation', url },
    organizer: {
      '@type': 'Person',
      name: site.loanOfficer.name,
      affiliation: { '@type': 'Organization', name: site.loanOfficer.company },
      url: site.baseUrl,
    },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url,
      validFrom: new Date().toISOString(),
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

/* ------------------------------------------------------------- form fields */

function extraFieldHtml(extra) {
  if (!extra) return '';
  const required = extra.required ? ' required' : '';
  const label = `${esc(extra.label)}${extra.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}`;

  if (extra.type === 'select') {
    const options = (extra.options || [])
      .map((o) => `<option value="${esc(o)}">${esc(o)}</option>`)
      .join('\n              ');
    return `<div class="field">
            <label for="extra">${label}</label>
            <select id="extra" name="${esc(extra.name)}"${required}>
              <option value="">Select one</option>
              ${options}
            </select>
          </div>`;
  }

  return `<div class="field">
            <label for="extra">${label}</label>
            <input type="text" id="extra" name="${esc(extra.name)}" placeholder="${esc(extra.placeholder || '')}" autocomplete="organization"${required}>
          </div>`;
}

/* ----------------------------------------------------------------- assets */

function copyAssets() {
  const assetDir = path.join(ROOT, 'src/assets');
  const versions = {};
  for (const file of fs.readdirSync(assetDir)) {
    const contents = fs.readFileSync(path.join(assetDir, file));
    write(path.join('assets', file), contents);
    versions[file] = hash(contents);
  }
  // Files served from the site root (robots.txt, favicons, verification files).
  const publicDir = path.join(ROOT, 'public');
  if (fs.existsSync(publicDir)) {
    for (const file of fs.readdirSync(publicDir)) {
      write(file, fs.readFileSync(path.join(publicDir, file)));
    }
  }
  return versions;
}

/* ------------------------------------------------------------------- build */

function main() {
  const site = readJson('data/site.json');
  const webinars = readJson('data/webinars.json').filter((w) => w.status !== 'draft');

  scanPlaceholders(site, 'site.json');
  webinars.forEach((w) => scanPlaceholders(w, `webinars.json (${w.slug})`));

  const baseUrl = site.baseUrl.replace(/\/$/, '');
  fs.rmSync(DIST, { recursive: true, force: true });
  const assetVersions = copyAssets();

  const base = read('src/templates/base.html');
  const homeTpl = read('src/templates/home.html');
  const webinarTpl = read('src/templates/webinar.html');
  const thanksTpl = read('src/templates/thank-you.html');
  const notFoundTpl = read('src/templates/404.html');

  const lo = site.loanOfficer;
  const year = new Date().getFullYear();

  // Shared chrome ------------------------------------------------------
  const nmlsLine = [
    lo.nmls && !unset(lo.nmls) ? `${esc(lo.name)} &middot; NMLS #${esc(lo.nmls)}` : `${esc(lo.name)} &middot; NMLS ID pending`,
    lo.companyNmls && !unset(lo.companyNmls)
      ? `${esc(lo.company)} &middot; NMLS #${esc(lo.companyNmls)}`
      : `${esc(lo.company)}`,
  ].join(' | ');

  const contactBits = [];
  if (!unset(lo.phone)) contactBits.push(`<a href="tel:${esc(telHref(lo.phone))}">${esc(lo.phone)}</a>`);
  if (!unset(lo.email)) contactBits.push(`<a href="mailto:${esc(lo.email)}">${esc(lo.email)}</a>`);

  const legal = site.legal || {};
  const footerLegal = [
    legal.disclaimer,
    legal.vaDisclaimer,
    legal.licensingNote,
  ]
    .filter(Boolean)
    .map((t) => `<p>${esc(t)}</p>`)
    .join('\n        ');

  const analytics = site.analytics?.ga4MeasurementId
    ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(site.analytics.ga4MeasurementId)}"></script>
  <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(site.analytics.ga4MeasurementId)}');</script>`
    : '';

  const logoCfg = site.logo || {};
  const logoFile = logoCfg.file && assetVersions[logoCfg.file] ? logoCfg.file : '';
  if (logoCfg.file && !logoFile) {
    console.log(`\n  Warning: logo file "src/assets/${logoCfg.file}" not found. Falling back to the text wordmark.`);
  }
  const logoSrc = logoFile ? `/assets/${logoFile}?v=${assetVersions[logoFile]}` : '';
  const logoHeight = Number(logoCfg.heightPx) || 42;

  const brandMark = logoSrc
    ? `<img class="brand__logo" src="${esc(logoSrc)}" alt="${esc(logoCfg.alt || site.siteName)}" style="height:${logoHeight}px">`
    : `<span class="brand__name">${esc(site.siteName)}</span>`;

  const footerMark = logoSrc
    ? `<img class="footer__logo" src="${esc(logoSrc)}" alt="${esc(logoCfg.alt || site.siteName)}" style="height:${Math.round(logoHeight * 0.85)}px">`
    : `<p class="footer__brand">${esc(site.siteName)}</p>`;

  const chrome = {
    brandMark,
    footerMark,
    siteName: site.siteName,
    tagline: site.tagline,
    year,
    nmlsLine,
    contactLine: contactBits.join(' &middot; '),
    // Whole elements, so nothing empty is rendered before contact details exist.
    mastheadContact: contactBits.length
      ? `<p class="masthead__contact">${contactBits.join(' &middot; ')}</p>`
      : '',
    footerContact: contactBits.length
      ? `<p class="footer__contact">${contactBits.join(' &middot; ')}</p>`
      : '',
    thanksContact: contactBits.length
      ? `<p class="thanks__contact">Questions before the class? Reach ${esc(lo.name)} directly: ${contactBits.join(' &middot; ')}</p>`
      : '',
    footerLegal,
    analytics,
    equalHousing: legal.equalHousing
      ? '<svg class="eho" viewBox="0 0 64 64" role="img" aria-label="Equal Housing Opportunity">' +
        '<title>Equal Housing Opportunity</title>' +
        '<path d="M6 30 32 10l26 20" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round" stroke-linecap="round"/>' +
        '<path d="M13 32v20h38V32" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>' +
        '<rect x="23" y="37" width="18" height="4" fill="currentColor"/>' +
        '<rect x="23" y="45" width="18" height="4" fill="currentColor"/>' +
        '</svg>'
      : '',
    consumerAccessUrl: legal.consumerAccessUrl || 'https://www.nmlsconsumeraccess.org/',
    cssVersion: assetVersions['styles.css'],
    jsVersion: assetVersions['app.js'],
    baseUrl,
  };

  const page = (vars) => render(base, { ...chrome, ...vars });

  // Webinar pages ------------------------------------------------------
  const cards = [];
  const sitemapUrls = [`${baseUrl}/`];

  for (const webinar of webinars) {
    const dates = deriveDates(webinar, site);
    const url = `${baseUrl}/webinars/${webinar.slug}/`;
    const whenLine = `${dates.weekday}, ${dates.dateLong} at ${dates.timeShort} ${site.timeZoneLabel}`;

    const ics = buildIcs(webinar, site, dates);
    write(`webinars/${webinar.slug}/${webinar.slug}.ics`, ics);

    const registerMode = unset(site.lead?.webhookUrl) ? 'redirect-only' : webinar.mode || 'form';
    const zoomUrl = unset(webinar.zoomRegistrationUrl) ? '' : webinar.zoomRegistrationUrl;

    const body = render(webinarTpl, {
      ...chrome,
      title: webinar.title,
      subtitle: webinar.subtitle,
      summary: webinar.summary,
      audienceLabel: webinar.audienceLabel,
      whenLine,
      weekday: dates.weekday,
      dateLong: dates.dateLong,
      dateShort: dates.dateShort,
      timeShort: dates.timeShort,
      timeZoneLabel: site.timeZoneLabel,
      timeZone: site.timeZone,
      duration: `${webinar.durationMinutes} minutes`,
      location: webinar.location || 'Live on Zoom',
      learnList: topicCards(webinar.learnPoints),
      forWhoList: audienceCards(webinar.forWho),
      topicCount: webinar.learnPoints.length,
      factChips: factChips([
        { icon: 'calendar', label: 'Date', value: esc(dates.dateMedium) },
        { icon: 'clock', label: 'Time', value: `${esc(dates.timeShort)} ${esc(site.timeZoneLabel)}` },
        { icon: 'video', label: 'Where', value: esc(webinar.location || 'Live on Zoom') },
        { icon: 'ticket', label: 'Cost', value: `Free &middot; ${esc(webinar.durationMinutes)} min` },
      ]),
      hostInitials: initials(lo.name),
      hostAvatar: lo.photo
        ? `<img class="host__photo" src="${esc(lo.photo)}" alt="${esc(lo.name)}">`
        : `<span class="host__initials" aria-hidden="true">${esc(initials(lo.name))}</span>`,
      extraField: extraFieldHtml(webinar.extraField),
      consentText: site.lead?.consentText || '',
      loName: lo.name,
      loTitle: lo.title,
      loCompany: lo.company,
      slug: webinar.slug,
      icsUrl: `/webinars/${webinar.slug}/${webinar.slug}.ics`,
      googleCalendarUrl: googleCalendarUrl(webinar, site, dates),
      isoStart: dates.start.toISOString(),
      pastNotice: dates.isPast
        ? '<p class="notice notice--past">This class has already taken place. Register below and we will send you the recording plus an invite to the next one.</p>'
        : '',
      registerMode,
      zoomUrl,
      webhookUrl: unset(site.lead?.webhookUrl) ? '' : site.lead.webhookUrl,
    });

    write(
      `webinars/${webinar.slug}/index.html`,
      page({
        pageTitle: `${webinar.title} | ${site.siteName}`,
        metaDescription: webinar.seoDescription || webinar.summary,
        canonical: url,
        bodyClass: 'page-webinar',
        head: eventJsonLd(webinar, site, dates),
        content: body,
      })
    );

    sitemapUrls.push(url);

    cards.push(`<a class="card${dates.isPast ? ' card--past' : ''}" href="/webinars/${esc(webinar.slug)}/">
          <span class="card__date"><span class="card__day">${esc(dates.dateShort)}</span><span class="card__year">${esc(dates.weekday)}</span></span>
          <span class="card__body">
            <span class="card__eyebrow">${esc(webinar.audienceLabel)}</span>
            <span class="card__title">${esc(webinar.title)}</span>
            <span class="card__meta">${esc(dates.timeShort)} ${esc(site.timeZoneLabel)} &middot; ${esc(webinar.durationMinutes)} min &middot; ${esc(webinar.location || 'Live on Zoom')}</span>
            <span class="card__sub">${esc(webinar.subtitle)}</span>
          </span>
          <span class="card__cta">${dates.isPast ? 'Get the recording' : 'Register'}</span>
        </a>`);
  }

  // Home ---------------------------------------------------------------
  write(
    'index.html',
    page({
      pageTitle: `${site.siteName} | ${site.tagline}`,
      metaDescription: `Live mortgage classes and webinars hosted by ${lo.name}, ${lo.title} at ${lo.company}. VA loan classes for real estate agents and home loan webinars for veterans and active-duty service members.`,
      canonical: `${baseUrl}/`,
      bodyClass: 'page-home',
      head: '',
      content: render(homeTpl, {
        ...chrome,
        loName: lo.name,
        loTitle: lo.title,
        loCompany: lo.company,
        cards: cards.join('\n        ') || '<p class="empty">No classes are scheduled right now. Check back soon.</p>',
        cardCount: cards.length,
      }),
    })
  );

  // Thank you ----------------------------------------------------------
  write(
    'thank-you/index.html',
    page({
      pageTitle: `You're registered | ${site.siteName}`,
      metaDescription: 'Registration confirmed.',
      canonical: `${baseUrl}/thank-you/`,
      bodyClass: 'page-thanks',
      head: '<meta name="robots" content="noindex">',
      content: render(thanksTpl, { ...chrome, loName: lo.name, contactLine: chrome.contactLine }),
    })
  );

  // 404 ----------------------------------------------------------------
  write(
    '404.html',
    page({
      pageTitle: `Page not found | ${site.siteName}`,
      metaDescription: 'Page not found.',
      canonical: `${baseUrl}/404.html`,
      bodyClass: 'page-404',
      head: '<meta name="robots" content="noindex">',
      content: render(notFoundTpl, chrome),
    })
  );

  // sitemap.xml --------------------------------------------------------
  write(
    'sitemap.xml',
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sitemapUrls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`
  );

  // robots.txt is copied from public/, but needs the real sitemap URL.
  write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${baseUrl}/sitemap.xml\n`);

  report(webinars, site);
}

function report(webinars, site) {
  console.log(`\n  Built ${webinars.length} webinar page(s) + home, thank-you, 404 into dist/\n`);

  if (placeholders.size === 0) {
    console.log('  No placeholders outstanding. Ready to deploy.\n');
    return;
  }

  console.log('  Still to fill in before launch:\n');
  for (const [name, locations] of [...placeholders].sort()) {
    console.log(`    <<${name}>>`);
    for (const loc of locations) console.log(`        ${loc}`);
  }

  if (site.logo?.isPlaceholder) {
    console.log(
      '  Note: the logo is a stand-in reproduction, not the official artwork.\n' +
        '        Drop the real file in at src/assets/' + (site.logo.file || 'logo.svg') +
        ' and set\n        logo.isPlaceholder to false in data/site.json.'
    );
  }

  if (unset(site.lead?.webhookUrl)) {
    console.log(
      '\n  Note: no lead webhook is set, so registration forms currently forward\n' +
        '        straight to each Zoom registration link instead of posting to the CRM.'
    );
  }
  console.log('');

  if (CHECK_MODE) process.exit(1);
}

main();
