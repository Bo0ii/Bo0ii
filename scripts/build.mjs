// Draws the profile panels as SVG (dark + light) from live GitHub data.
// Usage: GITHUB_TOKEN=... node scripts/build.mjs [outDir]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const LOGIN = 'Bo0ii';
const OUT = process.argv[2] ?? 'dist';

const PROFILE = {
  name: 'Amr Ahmed',
  role: 'Computer engineer · Full-stack developer · UAE',
  tagline: 'Native desktop software, real-time systems and the business platforms behind them.',
  focus: [
    { icon: 'monitor', title: 'Desktop & native', text: 'Cross-platform desktop apps that feel native: Rust cores inside Electron and Tauri shells.' },
    { icon: 'layout', title: 'Web platforms', text: 'Fast, polished web apps in Next.js and React, from marketing sites to full product dashboards.' },
    { icon: 'database', title: 'Business systems', text: 'ERP platforms with modules, roles and permissions, secure data flows and live dashboards.' },
    { icon: 'pen', title: 'Interface design', text: 'Three years of graphic design behind every screen: type, spacing and motion handled with care.' },
  ],
  links: [
    { id: 'web', label: 'cursorhop.com', icon: 'globe', tone: 'accent' },
    { id: 'linkedin', label: 'LinkedIn', icon: 'linkedin', tone: 'blue' },
    { id: 'email', label: 'Email', icon: 'mail', tone: 'amber' },
  ],
};

const THEMES = {
  dark: {
    surface: '#151b23', line: '#262c36', faint: '#3d444d', muted: '#8b949e',
    text: '#c9d1d9', strong: '#f0f3f6', accent: '#8fb5a2', blue: '#8ea7c2', amber: '#c4a77e',
  },
  light: {
    surface: '#f6f8fa', line: '#e1e5ea', faint: '#c4ccd5', muted: '#59636e',
    text: '#424a53', strong: '#1f2328', accent: '#41715c', blue: '#456482', amber: '#82693f',
  },
};

const SANS = `-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace`;
const W = 960;
const PAD = 38;

// ---------- data ----------

async function fetchDays() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const query = `query($login: String!) {
    user(login: $login) { contributionsCollection { contributionCalendar { weeks { contributionDays { date contributionCount } } } } }
  }`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': `${LOGIN}-profile-panels` },
    body: JSON.stringify({ query, variables: { login: LOGIN } }),
  });
  const json = await res.json();
  if (!res.ok || json.errors) throw new Error(`GitHub API: ${res.status} ${JSON.stringify(json.errors ?? json)}`);
  return json.data.user.contributionsCollection.contributionCalendar.weeks
    .flatMap((w) => w.contributionDays)
    .map((d) => ({ date: d.date, count: d.contributionCount }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-365);
}

function signalStats(days) {
  const counts = days.map((d) => d.count);
  const total = counts.reduce((a, b) => a + b, 0);
  const active = counts.filter((c) => c > 0).length;
  let longest = 0;
  let run = 0;
  for (const c of counts) {
    run = c > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today is usually still empty when the job runs, so a streak may end yesterday.
  let end = counts.length - 1;
  if (counts[end] === 0) end -= 1;
  let current = 0;
  while (end >= 0 && counts[end] > 0) { current += 1; end -= 1; }
  const weekdayTotals = Array(7).fill(0);
  for (const d of days) weekdayTotals[new Date(`${d.date}T00:00:00Z`).getUTCDay()] += d.count;
  const busiest = weekdayTotals.indexOf(Math.max(...weekdayTotals));
  const peak = days.reduce((best, d) => (d.count > best.count ? d : best), days[0]);
  return { total, active, longest, current, busiest, peak };
}

// ---------- helpers ----------

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n) => n.toLocaleString('en-US');
const r1 = (n) => Math.round(n * 10) / 10;

function stamp(iso) {
  const d = new Date(iso);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
// Keeps the hue, cuts the saturation, so brand colors sit quietly in the panel.
function soften(hex, keep = 0.62) {
  const c = rgb(hex);
  const grey = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
  return toHex(c.map((v) => grey + (v - grey) * keep));
}
// Brand colors that vanish on the surface get pushed toward white (dark) or black (light).
function readable(hex, bg, min = 3) {
  const target = luminance(bg) < 0.5 ? [255, 255, 255] : [0, 0, 0];
  let c = rgb(hex);
  for (let i = 0; i < 20 && contrast(toHex(c), bg) < min; i++) c = c.map((v, k) => v + (target[k] - v) * 0.15);
  return toHex(c);
}

// Filled card with a hairline edge; full panels also get a short accent mark on the top edge.
function card(w, h, t, inset, radius, mark) {
  const x = inset + 0.5;
  const y = inset + 0.5;
  let out = `<rect x="${x}" y="${y}" width="${w - inset * 2 - 1}" height="${h - inset * 2 - 1}" rx="${radius}" fill="${t.surface}" stroke="${t.line}"/>`;
  if (mark) out += `<path d="M${x + radius + 10} ${y}h28" stroke="${t.accent}" stroke-width="2" stroke-linecap="round"/>`;
  return out;
}

function frame(w, h, t, body, { inset = 6, radius = 12, mark = true } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" fill="none">
<style>
.s{font-family:${SANS}}
.lbl{font-family:${MONO};font-size:11px;font-weight:500;letter-spacing:.08em;fill:${t.muted}}
.tick{font-family:${MONO};font-size:10px;letter-spacing:.06em;fill:${t.muted}}
.pulse{transform-box:fill-box;transform-origin:center;animation:pulse 2.6s cubic-bezier(.2,.6,.3,1) infinite}
@keyframes pulse{0%{transform:scale(1);opacity:.5}80%,100%{transform:scale(3.4);opacity:0}}
.spark{stroke-dasharray:16 984;animation:spark 7s cubic-bezier(.45,0,.55,1) infinite}
@keyframes spark{0%{stroke-dashoffset:16}100%{stroke-dashoffset:-1000}}
.flash{opacity:0;animation:flash 4.4s ease-in-out infinite}
@keyframes flash{0%{opacity:0}8%{opacity:1}36%{opacity:0}100%{opacity:0}}
.grow{transform-box:fill-box;transform-origin:50% 100%;animation:grow .9s cubic-bezier(.2,.7,.2,1) both}
@keyframes grow{from{transform:scaleY(0)}to{transform:scaleY(1)}}
@media (prefers-reduced-motion:reduce){.pulse,.spark,.flash{animation:none;opacity:0}.grow{animation:none}}
</style>
${card(w, h, t, inset, radius, mark)}
${body}
</svg>
`;
}

const text = (x, y, cls, attrs, content) => `<text x="${r1(x)}" y="${r1(y)}" class="${cls}" ${attrs}>${esc(content)}</text>`;
const liveDot = (cx, cy, t) =>
  `<circle cx="${cx}" cy="${cy}" r="3.5" fill="${t.accent}" class="pulse"/><circle cx="${cx}" cy="${cy}" r="3.5" fill="${t.accent}"/>`;

function smoothPath(points) {
  // Catmull-Rom spline through the points, as cubic beziers.
  let d = `M${r1(points[0][0])} ${r1(points[0][1])}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p2[0])} ${r1(p2[1])}`;
  }
  return d;
}

// ---------- panels ----------

function hero(t, days, stats, now) {
  const h = 368;
  const x0 = PAD;
  const x1 = W - PAD;
  const top = 178;
  const base = 262;
  const n = days.length;
  const xs = (i) => x0 + (i / (n - 1)) * (x1 - x0);

  const counts = days.map((d) => d.count);
  const mean = counts.map((_, i) => {
    const a = Math.max(0, i - 3);
    const b = Math.min(n - 1, i + 3);
    let sum = 0;
    for (let j = a; j <= b; j++) sum += counts[j];
    return sum / (b - a + 1);
  });
  const sorted = [...counts].sort((a, b) => a - b);
  const p97 = sorted[Math.floor(sorted.length * 0.97)] || 1;
  const scale = Math.max(Math.max(...mean) * 1.25, p97, 1);
  const ys = (v) => base - Math.min(v / scale, 1) * (base - top);

  let body = '';
  body += text(PAD, 50, 'lbl', '', PROFILE.role.toUpperCase());
  body += text(W - PAD - 16, 50, 'lbl', 'text-anchor="end"', `SYNCED ${stamp(now)}`);
  body += liveDot(W - PAD - 4, 46, t);
  body += text(PAD, 92, 's', `font-size="34" font-weight="600" letter-spacing="-0.02em" fill="${t.strong}"`, PROFILE.name);
  body += text(PAD, 121, 's', `font-size="15" fill="${t.text}"`, PROFILE.tagline);

  body += text(PAD, 160, 'lbl', '', 'SIGNAL · LAST 365 DAYS');
  body += text(W - PAD, 160, 'lbl', 'text-anchor="end"', 'DAILY CONTRIBUTIONS · 7-DAY MEAN');

  // Raw days as faint ticks behind the trace.
  let ticks = '';
  counts.forEach((c, i) => {
    if (c > 0) ticks += `M${r1(xs(i))} ${base}V${r1(ys(c))}`;
  });
  body += `<path d="${ticks}" stroke="${t.faint}" stroke-width="1.3" opacity=".55"/>`;

  days.forEach((d, i) => {
    if (d.date.endsWith('-01')) {
      const x = r1(xs(i));
      body += `<line x1="${x}" y1="${base}" x2="${x}" y2="${base + 5}" stroke="${t.faint}"/>`;
      body += text(x + 4, base + 20, 'tick', '', MONTHS[Number(d.date.slice(5, 7)) - 1]);
    }
  });
  body += `<line x1="${x0}" y1="${base + 0.5}" x2="${x1}" y2="${base + 0.5}" stroke="${t.line}"/>`;

  const pts = mean.map((v, i) => [xs(i), ys(v)]);
  const line = smoothPath(pts);
  body += `<path d="${line}L${x1} ${base}L${x0} ${base}Z" fill="${t.strong}" opacity=".05"/>`;
  body += `<path d="${line}" stroke="${t.strong}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  body += `<path d="${line}" pathLength="1000" class="spark" stroke="${t.accent}" stroke-width="2.6" stroke-linecap="round"/>`;

  const pi = days.findIndex((d) => d.date === stats.peak.date);
  const px = xs(pi);
  const py = ys(stats.peak.count);
  body += `<circle cx="${r1(px)}" cy="${r1(py)}" r="2.5" fill="${t.strong}"/>`;
  const anchor = px > W - 160 ? 'end' : 'start';
  body += text(anchor === 'end' ? px - 7 : px + 7, py + 3.5, 'tick', `text-anchor="${anchor}"`, `PEAK ${stats.peak.count} · ${stamp(stats.peak.date).slice(0, 6)}`);

  const [ex, ey] = pts[pts.length - 1];
  body += liveDot(r1(ex), r1(ey), t);

  const items = [
    ['Contributions', num(stats.total)],
    ['Active days', `${stats.active} / ${n}`],
    ['Longest streak', `${stats.longest} days`],
    ['Current streak', `${stats.current} ${stats.current === 1 ? 'day' : 'days'}`],
    ['Busiest day', WEEKDAYS[stats.busiest]],
  ];
  const colW = (W - PAD * 2) / items.length;
  body += `<line x1="${PAD}" y1="298.5" x2="${W - PAD}" y2="298.5" stroke="${t.line}"/>`;
  items.forEach(([label, value], i) => {
    const x = PAD + i * colW;
    body += text(x, 324, 'lbl', '', label.toUpperCase());
    body += text(x, 348, 's', `font-size="19" font-weight="600" letter-spacing="-0.01em" fill="${t.strong}"`, value);
  });
  return frame(W, h, t, body);
}

function toolkit(t, icons) {
  const h = 128;
  const size = 26;
  const y = 66;
  const pitch = (W - PAD * 2 - size) / (icons.length - 1);
  // One full pass takes exactly one cycle, so the colored band loops like a snake with no pause.
  const step = 0.2;
  const cycle = r1(icons.length * step);
  let body = text(PAD, 46, 'lbl', '', 'STACK');
  icons.forEach((icon, i) => {
    const x = PAD + i * pitch;
    const color = readable(soften(icon.hex), t.surface);
    body += `<g transform="translate(${r1(x)} ${y}) scale(${size / 24})"><title>${esc(icon.title)}</title>`;
    body += `<path d="${icon.path}" fill="${t.muted}" opacity=".8"/>`;
    body += `<path d="${icon.path}" fill="${color}" class="flash" style="animation-duration:${cycle}s;animation-delay:${(i * step - cycle).toFixed(2)}s"/></g>`;
  });
  return frame(W, h, t, body);
}

const GLYPHS = {
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect width="4" height="12" x="2" y="9"/><circle cx="4" cy="4" r="2"/>',
  mail: '<rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>',
  arrow: '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>',
  monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  layout: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5V19A9 3 0 0 0 21 19V5"/><path d="M3 12A9 3 0 0 0 21 12"/>',
  pen: '<path d="M15.707 21.293a1 1 0 0 1-1.414 0l-1.586-1.586a1 1 0 0 1 0-1.414l5.586-5.586a1 1 0 0 1 1.414 0l1.586 1.586a1 1 0 0 1 0 1.414z"/><path d="m18 13-1.375-6.874a1 1 0 0 0-.746-.776L3.235 2.028a1 1 0 0 0-1.207 1.207L5.35 15.879a1 1 0 0 0 .776.746L13 18"/><path d="m2.3 2.3 7.286 7.286"/><circle cx="11" cy="11" r="2"/>',
};

const glyph = (name, x, y, size, color, width) =>
  `<g transform="translate(${x} ${y}) scale(${size / 24})" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none">${GLYPHS[name]}</g>`;

function wrap(str, max) {
  const lines = [];
  let line = '';
  for (const word of str.split(' ')) {
    if (line && `${line} ${word}`.length > max) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

function focus(t) {
  const h = 226;
  const colW = (W - PAD * 2) / PROFILE.focus.length;
  let body = text(PAD, 46, 'lbl', '', 'WHAT I BUILD');
  PROFILE.focus.forEach((f, i) => {
    const x = PAD + i * colW;
    body += glyph(f.icon, x, 66, 18, t.accent, 1.8);
    body += text(x, 112, 's', `font-size="15" font-weight="600" fill="${t.strong}"`, f.title);
    wrap(f.text, 30).slice(0, 4).forEach((l, j) => {
      body += text(x, 136 + j * 19, 's', `font-size="13" fill="${t.text}"`, l);
    });
  });
  return frame(W, h, t, body);
}

function bars(t, { x0, x1, base, height, items, highlight, label }) {
  const n = items.length;
  const max = Math.max(...items.map((d) => d.value), 1);
  const bw = Math.min(34, ((x1 - x0) / n) * 0.62);
  const pitch = (x1 - x0 - bw) / (n - 1);
  let out = text(x0, 46, 'lbl', '', label);
  items.forEach((d, i) => {
    const x = x0 + i * pitch;
    const bh = Math.max((d.value / max) * height, d.value > 0 ? 2 : 0);
    const fill = i === highlight ? t.accent : d.value === max ? t.muted : t.faint;
    if (bh > 0) {
      out += `<rect x="${r1(x)}" y="${r1(base - bh)}" width="${r1(bw)}" height="${r1(bh)}" rx="2" fill="${fill}" class="grow" style="animation-delay:${(i * 0.05).toFixed(2)}s"/>`;
    }
    out += text(x + bw / 2, base - bh - 7, 'tick', 'text-anchor="middle"', num(d.value));
    out += text(x + bw / 2, base + 20, 'tick', 'text-anchor="middle"', d.label);
  });
  out += `<line x1="${x0}" y1="${base + 0.5}" x2="${x1}" y2="${base + 0.5}" stroke="${t.line}"/>`;
  return out;
}

function rhythm(t, days) {
  const h = 212;
  const weekday = [0, 0, 0, 0, 0, 0, 0];
  const months = new Map();
  for (const d of days) {
    weekday[(new Date(`${d.date}T00:00:00Z`).getUTCDay() + 6) % 7] += d.count;
    const key = d.date.slice(0, 7);
    months.set(key, (months.get(key) ?? 0) + d.count);
  }
  const week = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((label, i) => ({ label, value: weekday[i] }));
  const month = [...months].slice(-12).map(([key, value]) => ({ label: MONTHS[Number(key.slice(5, 7)) - 1], value }));
  let body = bars(t, { x0: PAD, x1: 440, base: 168, height: 86, items: week, highlight: -1, label: 'WEEKLY RHYTHM' });
  body += bars(t, { x0: 500, x1: W - PAD, base: 168, height: 86, items: month, highlight: month.length - 1, label: 'MONTHLY VOLUME' });
  return frame(W, h, t, body);
}

function badge(t, link) {
  const h = 44;
  const w = Math.round(46 + link.label.length * 7.6 + 34);
  let body = glyph(link.icon, 16, 14, 16, t[link.tone], 2);
  body += text(42, 27, 's', `font-size="14" font-weight="500" fill="${t.strong}"`, link.label);
  body += glyph('arrow', w - 26, 16, 12, t.muted, 2.2);
  return frame(w, h, t, body, { inset: 0.5, radius: 8, mark: false });
}

// ---------- main ----------

const here = new URL('.', import.meta.url);
const icons = JSON.parse(await readFile(new URL('icons.json', here), 'utf8'));
const days = await fetchDays();
const stats = signalStats(days);
const now = new Date().toISOString();
await mkdir(OUT, { recursive: true });

const files = {};
for (const [mode, t] of Object.entries(THEMES)) {
  files[`hero-${mode}.svg`] = hero(t, days, stats, now);
  files[`focus-${mode}.svg`] = focus(t);
  files[`stack-${mode}.svg`] = toolkit(t, icons);
  files[`rhythm-${mode}.svg`] = rhythm(t, days);
  for (const link of PROFILE.links) files[`link-${link.id}-${mode}.svg`] = badge(t, link);
}
await Promise.all(Object.entries(files).map(([name, svg]) => writeFile(join(OUT, name), svg)));
console.log(`Drew ${Object.keys(files).length} panels into ${OUT}/ (${num(stats.total)} contributions, peak ${stats.peak.count} on ${stats.peak.date})`);
