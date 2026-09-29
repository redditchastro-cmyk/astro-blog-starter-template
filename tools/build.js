#!/usr/bin/env node
/*
 * RAS site build.  Run from the project root:   node tools/build.js
 *
 * No dependencies. Cloudflare Pages runs it on every deploy, and you can run
 * it locally to preview changes. It:
 *   1. checks data/events.json (and the other data files) for mistakes;
 *   2. writes the shared <head>, header and footer into every page;
 *   3. pre-renders event lists, news, committee and gallery from data/*.json;
 *   4. generates one page per event under /events/YYYY/MM/slug/;
 *   5. writes sitemap.xml and robots.txt.
 *
 * Pages are edited in place: only the regions between <!--#name--> and
 * <!--/name--> markers are replaced, so everything else is yours to edit.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const RAS = require(path.join(ROOT, 'js/events.js'));

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const readJson = (p) => {
  try { return JSON.parse(read(p)); }
  catch (e) { fail(`${p} is not valid JSON: ${e.message}`); }
};
const esc = RAS.esc;

function fail(msg) {
  console.error('\n  BUILD FAILED: ' + msg + '\n');
  process.exit(1);
}

const config = readJson('site.config.json');
const SITE = String(config.siteUrl || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(SITE)) fail('site.config.json: siteUrl must start with https://');
const SITE_NAME = 'Redditch Astronomical Society';

const events = readJson('data/events.json');
const venueList = readJson('data/venues.json');
const news = readJson('data/news.json');
const committee = readJson('data/committee.json');
const gallery = readJson('data/gallery.json');
const venues = RAS.venueIndex(venueList);

/* ---------- 1. validation ---------- */

const TYPES = ['Meeting', 'Public Event', 'Observing', 'Workshop', 'Social', 'Trip'];
function validateEvents() {
  const errors = [];
  const ids = new Set();
  const urls = new Set();
  if (!Array.isArray(events)) fail('data/events.json must be a list [ ... ] of events');
  events.forEach((ev, i) => {
    const where = `event #${i + 1} (${ev.title || ev.id || 'untitled'})`;
    if (!ev.id) errors.push(`${where}: missing "id"`);
    if (ids.has(ev.id)) errors.push(`${where}: duplicate id "${ev.id}"`);
    ids.add(ev.id);
    if (!ev.title) errors.push(`${where}: missing "title"`);
    if (!ev.slug || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(ev.slug)) errors.push(`${where}: "slug" must be lower-case words joined by hyphens`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.date || '') || isNaN(Date.parse(ev.date))) errors.push(`${where}: "date" must look like 2026-10-06`);
    ['startTime', 'endTime'].forEach((k) => {
      if (ev[k] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(ev[k])) errors.push(`${where}: "${k}" must look like 19:00 (24-hour clock) or be empty`);
    });
    if (ev.endTime && !ev.startTime) errors.push(`${where}: has an endTime but no startTime`);
    if (ev.startTime && ev.endTime && ev.endTime <= ev.startTime) errors.push(`${where}: endTime must be after startTime`);
    if (!TYPES.includes(ev.type)) errors.push(`${where}: "type" must be one of: ${TYPES.join(', ')}`);
    if (ev.venueId && !venues[ev.venueId]) errors.push(`${where}: venueId "${ev.venueId}" is not in data/venues.json`);
    ['bookingUrl', 'speakerUrl'].forEach((k) => {
      if (ev[k] && !/^https?:\/\//.test(ev[k])) errors.push(`${where}: "${k}" must be a full web address starting https://`);
    });
    if (ev.image && !ev.image.startsWith('/images/')) errors.push(`${where}: "image" should be a path like /images/events/photo.webp`);
    if (ev.image && !fs.existsSync(path.join(ROOT, ev.image))) errors.push(`${where}: image file ${ev.image} does not exist`);
    const url = RAS.eventUrl(ev);
    if (urls.has(url)) errors.push(`${where}: two events would share the page ${url}; change one slug`);
    urls.add(url);
  });
  if (errors.length) fail('data/events.json has problems:\n    - ' + errors.join('\n    - '));
}
validateEvents();

/* ---------- helpers ---------- */

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name.startsWith('.') || ['node_modules', 'partials', 'tools'].includes(name)) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
}

function urlPathFor(file) {
  let rel = '/' + path.relative(ROOT, file).split(path.sep).join('/');
  if (rel.endsWith('/index.html')) rel = rel.slice(0, -'index.html'.length);
  return rel;
}

function replaceRegion(html, name, content) {
  const re = new RegExp(`<!--#${name}-->[\\s\\S]*?<!--/${name}-->`, 'g');
  return html.replace(re, `<!--#${name}-->\n${content}\n<!--/${name}-->`);
}

function attr(html, re) {
  const m = html.match(re);
  return m ? m[1] : '';
}

function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}

/* ---------- 2. shared regions ---------- */

const headPartial = read('partials/head.html').trim();
const headerPartial = read('partials/header.html').trim();
const footerPartial = read('partials/footer.html').trim();

function headFor(urlPath, html, ogImage) {
  const title = decode(attr(html, /<title>([\s\S]*?)<\/title>/));
  const desc = decode(attr(html, /<meta name="description" content="([^"]*)"/));
  const image = SITE + (ogImage || '/images/og-image.png');
  const canonical = SITE + urlPath;
  const tags = [
    headPartial,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<meta property="og:site_name" content="${SITE_NAME}">`,
    `<meta property="og:type" content="${urlPath === '/' ? 'website' : 'article'}">`,
    `<meta property="og:title" content="${esc(title.replace(/ \| Redditch Astronomical Society$/, ''))}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:url" content="${esc(canonical)}">`,
    `<meta property="og:image" content="${esc(image)}">`,
    `<meta property="og:locale" content="en_GB">`,
    `<meta name="twitter:card" content="summary_large_image">`
  ];
  return tags.join('\n');
}

function headerFor(urlPath) {
  let h = headerPartial.replace(/<a href="([^"]+)">/g, (m, href) =>
    href === urlPath ? `<a href="${href}" aria-current="page">` : m);
  h = h.replace(/<li data-section="([^"]+)">/g, (m, section) =>
    urlPath.startsWith(section) ? `<li data-section="${section}" class="is-active">` : m);
  return h;
}

/* ---------- 3. data-driven regions ---------- */

const buildNow = new Date();

function renderNews(items, limit) {
  const list = items.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit || items.length);
  if (!list.length) return '<p class="empty">No news yet.</p>';
  return '<ul class="news-list" role="list">' + list.map((n) => {
    const title = n.url ? `<a href="${esc(n.url)}">${esc(n.title)}</a>` : esc(n.title);
    return `<li class="card news-item" id="${esc(n.id)}">` +
      (n.date ? `<time datetime="${esc(n.date)}">${esc(RAS.formatDate(n.date))}</time>` : '') +
      `<h2>${title}</h2>` +
      (n.image ? `<img src="${esc(n.image)}" alt="${esc(n.imageAlt || '')}" loading="lazy">` : '') +
      (n.summary ? `<p>${esc(n.summary)}</p>` : '') + '</li>';
  }).join('') + '</ul>';
}

function initials(name) {
  const words = String(name).replace(/^(Dr|Prof|Mr|Mrs|Ms|Miss)\.?\s+/i, '').split(/\s+/).filter(Boolean);
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

function renderCommittee(people) {
  const list = (people || []).filter((p) => p.name && p.role);
  if (!list.length) {
    return '<div class="todo"><p>The current committee members and their roles have not yet been confirmed for the new website. ' +
      'Committee details will be added here once RAS has confirmed them.</p>' +
      '<p>In the meantime, you can reach the committee at <a href="mailto:redditchastro@gmail.com">redditchastro@gmail.com</a>.</p></div>';
  }
  return '<ul class="grid grid--3" role="list">' + list.map((p) =>
    '<li class="card person">' +
    (p.image ? `<img class="person__img" src="${esc(p.image)}" alt="${esc(p.name)}" width="88" height="88" loading="lazy">`
      : `<span class="person__initials" aria-hidden="true">${esc(initials(p.name))}</span>`) +
    `<h2 class="h3">${esc(p.name)}</h2><p class="person__role">${esc(p.role)}</p>` +
    (p.bio ? `<p>${esc(p.bio)}</p>` : '') + '</li>').join('') + '</ul>';
}

function renderGallery(items) {
  const list = (items || []).filter((g) => g.image);
  if (!list.length) {
    return '<div class="notice"><p><strong>Our gallery is being prepared.</strong> We are gathering photographs taken by RAS members and at society events, and they will appear here soon.</p>' +
      '<p>Are you a member with an image to share? Email it to <a href="mailto:redditchastro@gmail.com?subject=Gallery%20image">redditchastro@gmail.com</a> with a title, how it was taken and the name you would like credited.</p></div>';
  }
  return '<ul class="gallery-grid" role="list" data-gallery>' + list.map((g) => {
    const meta = JSON.stringify({
      title: g.title, photographer: g.photographer, description: g.description,
      equipment: g.equipment, camera: g.camera, exposure: g.exposure, processing: g.processing
    });
    const caption = [g.title, g.photographer ? 'by ' + g.photographer : ''].filter(Boolean).join(' ');
    return `<li><figure class="gallery-item"><a href="${esc(g.image)}" data-full="${esc(g.image)}" data-meta="${esc(meta)}">` +
      `<img src="${esc(g.thumbnail || g.image)}" alt="${esc(g.alt || g.title || '')}" loading="lazy" decoding="async" width="600" height="600"></a>` +
      (caption ? `<figcaption>${esc(caption)}</figcaption>` : '') + '</figure></li>';
  }).join('') + '</ul>';
}

const upcomingNow = RAS.upcoming(events, buildNow);
const regions = {
  'render:next-event': () => RAS.renderNextEvent(RAS.nextEvent(events, buildNow), venues),
  'render:upcoming-3': () => RAS.renderList(upcomingNow.slice(0, 3), venues,
    '<p class="empty">No further events have been announced yet.</p>'),
  'render:programme': () => RAS.renderList(upcomingNow, venues,
    '<p class="empty">No upcoming events have been announced yet.</p>'),
  'render:past': () => RAS.renderArchive(RAS.past(events, buildNow), venues),
  'render:news': () => renderNews(news),
  'render:committee': () => renderCommittee(committee),
  'render:gallery': () => renderGallery(gallery),
  'render:org-jsonld': () => RAS.jsonLdScript({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    alternateName: 'RAS',
    url: SITE + '/',
    email: 'redditchastro@gmail.com',
    description: 'A friendly amateur astronomy society serving Redditch, Bromsgrove and the surrounding area.',
    areaServed: ['Redditch', 'Bromsgrove'],
    sameAs: ['https://www.facebook.com/RedditchAstronomicalSociety/']
  })
};

/* ---------- 4. event pages ---------- */

const GENERATED_MARK = '<meta name="generator" content="ras-build:event-page">';

function eventPageHtml(ev) {
  const urlPath = RAS.eventUrl(ev);
  const v = ev.venueId && venues[ev.venueId];
  const title = `${ev.title} | ${RAS.formatDate(ev.date)} | ${SITE_NAME}`;
  const descBits = [RAS.formatDate(ev.date), RAS.formatTime(ev.startTime), v ? v.name : ''].filter(Boolean).join(', ');
  const desc = `${ev.shortDescription || ev.title} ${descBits}.`.replace(/\.\s/, '. ').trim();
  const shell = `<!doctype html>
<html lang="en-GB">
<head>
<!--#head--><!--/head-->
${GENERATED_MARK}
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
${RAS.jsonLdScript(RAS.eventJsonLd(ev, venues, SITE))}
<script src="/js/events.js" defer></script>
</head>
<body>
<!--#header--><!--/header-->
<main id="main">
<div class="container">
${RAS.renderEventPage(ev, venues, SITE)}
</div>
</main>
<!--#footer--><!--/footer-->
</body>
</html>
`;
  return { urlPath, html: shell };
}

function writeEventPages() {
  const wanted = new Set();
  for (const ev of events) {
    if (ev.url) continue; // hand-written page (e.g. the eclipse competition)
    const { urlPath, html } = eventPageHtml(ev);
    const file = path.join(ROOT, urlPath, 'index.html');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
    wanted.add(file);
  }
  // Remove pages for events that were deleted or renamed.
  const eventsDir = path.join(ROOT, 'events');
  walk(eventsDir).forEach((file) => {
    if (wanted.has(file)) return;
    if (read(path.relative(ROOT, file)).includes(GENERATED_MARK)) {
      fs.unlinkSync(file);
      let dir = path.dirname(file);
      while (dir !== eventsDir && fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); }
      console.log('  removed old event page ' + urlPathFor(file));
    }
  });
  return wanted.size;
}

// Turn root-relative links ("/about/") into page-relative ones ("../about/"),
// so pages keep their styling and links even when opened from a folder or a
// preview that isn't served from the site root. The 404 page is skipped
// because it is served at any address.
function relativize(html, urlPath) {
  const depth = urlPath.replace(/[^/]*$/, '').split('/').filter(Boolean).length;
  const prefix = '../'.repeat(depth);
  return html.replace(/\b(href|src|data-full)="\/(?!\/)([^"]*)"/g, (m, a, rest) => `${a}="${(prefix + rest) || './'}"`);
}

/* ---------- run ---------- */

const eventPageCount = writeEventPages();

const pages = walk(ROOT);
const sitemapUrls = [];
for (const file of pages) {
  const urlPath = urlPathFor(file);
  let html = fs.readFileSync(file, 'utf8');
  const before = html;
  const ogImage = attr(html, /<meta name="ras:og-image" content="([^"]*)"/) || null;
  const ev = html.includes(GENERATED_MARK) ? events.find((e) => RAS.eventUrl(e) === urlPath) : null;
  html = replaceRegion(html, 'head', headFor(urlPath, html, (ev && ev.image) || ogImage));
  html = replaceRegion(html, 'header', headerFor(urlPath));
  html = replaceRegion(html, 'footer', footerPartial);
  for (const [name, fn] of Object.entries(regions)) {
    if (html.includes(`<!--#${name}-->`)) html = replaceRegion(html, name, fn());
  }
  if (!urlPath.endsWith('404.html')) html = relativize(html, urlPath);
  if (html !== before) fs.writeFileSync(file, html);
  const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
  if (!noindex && !urlPath.endsWith('404.html')) sitemapUrls.push(urlPath);
}

sitemapUrls.sort((a, b) => (a === '/' ? -1 : b === '/' ? 1 : a.localeCompare(b)));
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
  '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  sitemapUrls.map((u) => `  <url><loc>${esc(SITE + u)}</loc></url>`).join('\n') + '\n</urlset>\n');

fs.writeFileSync(path.join(ROOT, 'robots.txt'),
  `User-agent: *\nAllow: /\nDisallow: /tools/\nDisallow: /partials/\n\nSitemap: ${SITE}/sitemap.xml\n`);

console.log(`  RAS build OK: ${events.length} events (${upcomingNow.length} upcoming), ${eventPageCount} event pages, ${pages.length} pages, ${sitemapUrls.length} sitemap URLs.`);
