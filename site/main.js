import { createStone } from './stone.js';

const $ = (s) => document.querySelector(s);

// Both stones share one look: a raking warm key, a cool rim, deep shadows, and light (not dust) when touched.
const LOOK = { look: 'cinematic', variant: 'light', res: 2, albedo: 2, speck: 70, graze: 20, light: 1.6 };

// ---------- hero stone: tap to decode the runes into INDEX · KEEP WHAT YOU READ
// Sits centred and high, with the copy over its lower-left corner (Figma: Hero).
const wide = (w) => w >= 900;
createStone($('#hero-stone'), {
  ...LOOK,
  mode: 'hero',
  exposure: 1.25,
  fit: (w = innerWidth) => (wide(w) ? 0.98 : 0.84),
  lift: (w = innerWidth) => (wide(w) ? 0.07 : 0.3),
});

// ---------- step tiles: drawn at 357px, scaled to their column
const TILE = 357.33;
for (const tile of document.querySelectorAll('.tile')) {
  new ResizeObserver(([e]) => tile.style.setProperty('--k', (e.contentRect.width / TILE).toFixed(4))).observe(tile);
}

// ---------- waitlist: a blank stone that carves your name when you join
// Created about a screen before it scrolls into view (or when the form is used), not at load:
// that saves a second WebGL context, a shader build and ~95 MB of engraving texture for visitors who never get here.
let carve = null;
const makeCarve = () => (carve ||= createStone($('#carve-stone'), {
  ...LOOK,
  mode: 'carve',
  exposure: 1.2,
  // the canvas covers only the visible part of the section; this places the stone (centre px, px per metre)
  // exactly as the old oversized canvas did: big, cropped by the section and the right edge
  frame: (w) => (innerWidth >= 900 ? { x: 580, y: 470, scale: 516 } : { x: w / 2, y: 150, scale: 249 }),
  nameSize: 190,    // big, deep letters: the name is the point of this stone
  nameWidth: 760,   // widest a line may run (mm of the 1888 mm face), so it stays clear of the page edge
  rest: { x: -0.03, y: 0.1, z: -0.04 },
}));
const near = new IntersectionObserver(([e]) => { if (e.isIntersecting) { makeCarve(); near.disconnect(); } }, { rootMargin: '100% 0px' });
near.observe($('#waitlist'));

const form = $('#form'), emailIn = $('#email'), btn = $('#submit'), err = $('#error'), done = $('#done');
const ERR_ICON = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13Zm-.75 3.25h1.5v4.5h-1.5v-4.5ZM8 11.75a.9.9 0 1 1 0-1.8.9.9 0 0 1 0 1.8Z"/></svg>';
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
let tried = false;

// The name on the stone is the part before the @: "ada.lovelace+news@…" carves ADA LOVELACE.
function nameFromEmail(email) {
  const local = email.trim().split('@')[0].split('+')[0];
  const words = local.replace(/[._\-]+/g, ' ').replace(/\d+/g, ' ').trim().replace(/\s+/g, ' ');
  return (words || local).slice(0, 40);
}

function showError(msg) {
  err.innerHTML = msg ? `${ERR_ICON}<span></span>` : '';
  if (msg) err.querySelector('span').textContent = msg;
}
function validate() {
  const v = emailIn.value;
  const msg = emailOk(v) ? ''
    : !v.trim() ? 'Add your email, like name@example.com.'
    : v.includes('@') ? 'That email is missing a domain, like name@example.com.'
    : 'Your email needs an @, like name@example.com.';
  emailIn.setAttribute('aria-invalid', String(!!msg));
  showError(msg);
  return !msg;
}
// draw the name's letters in idle time while the email is typed, so carving starts without a pause
let prepT = 0;
emailIn.addEventListener('input', () => {
  if (tried) validate();
  clearTimeout(prepT);
  prepT = setTimeout(() => { if (emailOk(emailIn.value)) makeCarve().prepare(nameFromEmail(emailIn.value)); }, 300);
});
emailIn.addEventListener('focus', makeCarve, { once: true });

// Adds the email to the waitlist (api/waitlist.js → a Resend segment). Nothing else is stored.
async function joinWaitlist({ email }) {
  const r = await fetch('/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, company: $('#company').value }),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok && data.ok, status: r.status, error: data.error };
}

// bring the stone into view by scrolling the page only, never a clipped box inside it
function revealStone() {
  const r = $('#carve-stone').getBoundingClientRect();
  const sec = $('#waitlist').getBoundingClientRect();
  const top = Math.max(r.top, sec.top), bottom = Math.min(r.bottom, sec.bottom);
  let dy = 0;
  if (top < 0) dy = top; else if (bottom > innerHeight) dy = Math.min(bottom - innerHeight, top);
  if (dy) scrollBy({ top: dy, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault(); tried = true;
  if (!validate()) { emailIn.focus(); return; }
  makeCarve();
  if (carve.busy) return;
  const email = emailIn.value.trim(), name = nameFromEmail(email);
  btn.disabled = true; btn.textContent = 'Joining…';
  const res = await joinWaitlist({ email }).catch(() => ({ ok: false }));
  if (!res.ok) {
    btn.disabled = false; btn.textContent = 'Join waitlist';
    showError(res.status === 429 ? 'Too many tries. Wait a few minutes and try again.'
      : res.error === 'invalid_email' ? 'That email doesn’t look right, like name@example.com.'
      : 'That didn’t go through. Try again in a moment.');
    return;
  }
  btn.textContent = 'Carving…';
  revealStone();
  await carve.ready;
  await carve.engrave(name);
  form.hidden = true; $('#note').hidden = true;
  done.innerHTML = '<strong>Carved. You’re on the list.</strong> <span></span>';
  done.querySelector('span').textContent = `We’ll write to ${email} when there’s a build for you.`;
  done.hidden = false;
});
