// POST /api/waitlist  { email, company }  →  adds the email to the Index waitlist segment in Resend.
//
// Env (Vercel → Settings → Environment Variables):
//   RESEND_API_KEY     full-access key (secret; never in the repo)
//   RESEND_SEGMENT_ID  the "Index waitlist" segment (optional: defaults to the one below)
//   RESEND_FROM        optional, e.g. "Index <hello@example.com>": when set, sends a short confirmation email
//
// Stores nothing itself: the contact lives in Resend, where it can be exported or deleted.

const SEGMENT = process.env.RESEND_SEGMENT_ID || 'e071b819-fcb4-4367-bc86-4b2822bc71c0';
const API = 'https://api.resend.com';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Best-effort per-IP limit. Each function instance keeps its own map, so this only blunts bursts;
// the honeypot and Resend's own limits do the rest.
const hits = new Map();
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000, max = 5;
  const list = (hits.get(ip) || []).filter((t) => now - t < win);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > max;
}

const resend = (path, body, method = 'POST') => fetch(API + path, {
  method,
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ ok: false }); }

  // same-origin only: the form posts from this site, nobody else should
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ ok: false });

  const body = typeof req.body === 'string' ? safeJSON(req.body) : (req.body || {});
  // honeypot: people never see or fill "company"; bots that fill every field get a quiet success
  if (body.company) return res.status(200).json({ ok: true });

  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) return res.status(400).json({ ok: false, error: 'invalid_email' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });

  if (!process.env.RESEND_API_KEY) { console.error('waitlist: RESEND_API_KEY is not set'); return res.status(500).json({ ok: false }); }

  try {
    const r = await resend('/contacts', { email, unsubscribed: false, segments: [{ id: SEGMENT }] });
    if (!r.ok) {
      // already a contact (from another list or an earlier signup): just make sure it's in the waitlist segment
      const add = await resend(`/contacts/${encodeURIComponent(email)}/segments/${SEGMENT}`);
      if (!add.ok) {
        console.error('waitlist: resend', r.status, await r.text().catch(() => ''), add.status, await add.text().catch(() => ''));
        return res.status(502).json({ ok: false });
      }
    }
    if (process.env.RESEND_FROM) {
      // the confirmation is a courtesy: if it fails, the signup still counts
      await resend('/emails', {
        from: process.env.RESEND_FROM,
        to: email,
        subject: 'You’re on the Index waitlist',
        text: 'Thanks for joining the Index waitlist. We’ll write when there’s a build for you.\n\nIf this wasn’t you, reply and we’ll remove your address.',
      }).catch((e) => console.error('waitlist: confirmation', e));
    }
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('waitlist:', e);
    return res.status(502).json({ ok: false });
  }
}

function safeJSON(s) { try { return JSON.parse(s); } catch { return {}; } }
