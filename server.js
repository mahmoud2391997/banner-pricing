#!/usr/bin/env node
/*
 * Banner pricing server — no dependencies, Node 18+.
 *
 *   GET  /                 product page
 *   GET  /pricing.json     current pricing config (public)
 *   GET  /admin            pricing editor
 *   PUT  /admin/pricing    save pricing (requires X-Admin-Token = $ADMIN_TOKEN)
 *   POST /api/quote        recompute a price server-side (for your real cart to call)
 *
 * Built-in cart/checkout (for testing, or as a stand-in until wired to your cart):
 *   POST /cart/add   GET /cart   POST /cart/remove   POST /checkout   GET /orders/:id
 *
 * Every add-to-cart is re-priced on the server from config/pricing.json. A request
 * whose posted price doesn't match is rejected, so a customer can't edit the price
 * in their browser.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PricingCore = require('./public/assets/pricing-core.js');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const CONFIG_PATH = process.env.PRICING_CONFIG || path.join(ROOT, 'config', 'pricing.json');
const ORDERS_DIR = path.join(ROOT, 'orders');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon'
};

const carts = new Map(); // sessionId -> [line items]

function loadConfig() { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(cents, cfg) {
  return new Intl.NumberFormat(cfg.locale || 'en-US', { style: 'currency', currency: cfg.currency || 'USD' }).format(cents / 100);
}

function send(res, status, body, type, headers) {
  res.writeHead(status, Object.assign({ 'Content-Type': type || 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {}));
  res.end(body);
}
function json(res, status, obj) { send(res, status, JSON.stringify(obj), MIME['.json']); }
function redirect(res, to) { res.writeHead(303, { Location: to }); res.end(); }

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const type = req.headers['content-type'] || '';
      try {
        if (type.includes('application/json')) resolve(raw ? JSON.parse(raw) : {});
        else resolve(Object.fromEntries(new URLSearchParams(raw)));
      } catch (e) { reject(new Error('Invalid request body')); }
    });
    req.on('error', reject);
  });
}

function session(req, res) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{32})/.exec(req.headers.cookie || '');
  if (m) return m[1];
  const sid = crypto.randomBytes(16).toString('hex');
  res.setHeader('Set-Cookie', `sid=${sid}; Path=/; HttpOnly; SameSite=Lax`);
  return sid;
}

function wantsJson(req) {
  return (req.headers['content-type'] || '').includes('application/json') || (req.headers.accept || '').includes('application/json');
}

// Map incoming field names (configurable in pricing.json → cart.fieldNames) back to canonical keys.
function readCartFields(body, cfg) {
  const n = Object.assign({ materialId: 'material_id', widthFt: 'width_ft', heightFt: 'height_ft', priceCents: 'price_cents', productId: 'product_id' },
    (cfg.cart && cfg.cart.fieldNames) || {});
  return {
    productId: body[n.productId],
    materialId: body[n.materialId],
    widthFt: body[n.widthFt],
    heightFt: body[n.heightFt],
    priceCents: body[n.priceCents]
  };
}

function validateConfig(c) {
  const errs = [];
  if (!c || typeof c !== 'object') return ['Config must be an object.'];
  if (!(Number(c.setupFee) >= 0)) errs.push('Setup fee must be 0 or more.');
  if (!Array.isArray(c.materials) || c.materials.length === 0) errs.push('Add at least one material.');
  const ids = new Set();
  (c.materials || []).forEach((m, i) => {
    if (!m.name || !String(m.name).trim()) errs.push(`Material ${i + 1} needs a name.`);
    if (!(Number(m.ratePerSqFt) > 0)) errs.push(`"${m.name || 'Material ' + (i + 1)}" needs a rate above $0.`);
    if (!m.id || !/^[a-z0-9-]+$/.test(m.id)) errs.push(`Material ${i + 1} has an invalid id.`);
    if (ids.has(m.id)) errs.push(`Duplicate material id "${m.id}".`);
    ids.add(m.id);
  });
  if (!(c.materials || []).some((m) => m.active !== false)) errs.push('At least one material must be shown.');
  const l = c.limits || {};
  if (!(Number(l.minFt) > 0)) errs.push('Minimum side must be above 0.');
  if (!(Number(l.maxWidthFt) >= Number(l.minFt)) || !(Number(l.maxHeightFt) >= Number(l.minFt))) errs.push('Max sizes must be at least the minimum side.');
  return errs;
}

function page(title, inner) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><link rel="stylesheet" href="/assets/styles.css">
<style>.wrap{max-width:760px;margin:0 auto;padding:32px 16px;display:grid;gap:20px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:20px}
.line{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--line)}
.line:last-child{border-bottom:0}.meta{color:var(--muted);font-size:14px}.tot{font-size:22px;font-weight:700}
.inline{display:inline}.link{background:none;border:0;color:var(--error);cursor:pointer;padding:0;font:inherit;font-size:14px}</style>
</head><body><main class="wrap">${inner}</main></body></html>`;
}

function cartPage(items, cfg) {
  if (!items.length) return page('Your cart', `<h1>Your cart</h1><div class="card"><p>Your cart is empty.</p><a href="/">Design a banner →</a></div>`);
  const total = items.reduce((s, i) => s + i.totalCents, 0);
  const lines = items.map((i, idx) => `<div class="line"><div><strong>${esc(i.materialName)}</strong>
<div class="meta">${esc(i.widthFt)} × ${esc(i.heightFt)} ft · ${esc(i.sqft)} sq ft @ ${money(PricingCore.toCents(i.ratePerSqFt), cfg)}/sq ft + ${money(i.setupCents, cfg)} setup</div>
<form class="inline" method="post" action="/cart/remove"><input type="hidden" name="index" value="${idx}"><button class="link">Remove</button></form></div>
<div>${money(i.totalCents, cfg)}</div></div>`).join('');
  return page('Your cart', `<h1>Your cart</h1><div class="card">${lines}
<div class="line tot"><span>Total</span><span>${money(total, cfg)}</span></div></div>
<form method="post" action="/checkout"><button class="btn" style="width:100%">Proceed to checkout</button></form>
<a href="/">← Add another item</a>`);
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (req.method === 'GET' && p === '/pricing.json') return send(res, 200, fs.readFileSync(CONFIG_PATH), MIME['.json']);

  if (req.method === 'PUT' && p === '/admin/pricing') {
    if (!ADMIN_TOKEN) return json(res, 403, { error: 'Saving is disabled: start the server with ADMIN_TOKEN set.' });
    const given = Buffer.from(String(req.headers['x-admin-token'] || ''));
    const want = Buffer.from(ADMIN_TOKEN);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return json(res, 401, { error: 'Wrong admin token.' });
    const body = await readBody(req);
    const current = loadConfig();
    const next = {
      ...current,
      productName: String(body.productName || current.productName || '').slice(0, 120),
      setupFee: Math.round(Number(body.setupFee) * 100) / 100,
      limits: { minFt: Number(body.limits && body.limits.minFt), maxWidthFt: Number(body.limits && body.limits.maxWidthFt), maxHeightFt: Number(body.limits && body.limits.maxHeightFt) },
      materials: (Array.isArray(body.materials) ? body.materials : []).map((m) => ({
        id: String(m.id || ''), name: String(m.name || '').trim().slice(0, 120),
        ratePerSqFt: Math.round(Number(m.ratePerSqFt) * 100) / 100, active: m.active !== false
      }))
    };
    const errs = validateConfig(next);
    if (errs.length) return json(res, 400, { error: errs.join(' ') });
    const tmp = CONFIG_PATH + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
    fs.renameSync(tmp, CONFIG_PATH);
    return json(res, 200, { ok: true, config: next });
  }

  if (req.method === 'POST' && p === '/api/quote') {
    const cfg = loadConfig();
    const q = PricingCore.quote(cfg, readCartFields(await readBody(req), cfg));
    return json(res, q.ok ? 200 : 400, q.ok ? q : { error: q.errors.join(' '), errors: q.errors });
  }

  if (req.method === 'POST' && p === '/cart/add') {
    const sid = session(req, res);
    const cfg = loadConfig();
    const f = readCartFields(await readBody(req), cfg);
    const q = PricingCore.quote(cfg, f);
    const fail = (msg) => wantsJson(req) ? json(res, 400, { error: msg })
      : send(res, 400, page('Could not add to cart', `<h1>Could not add to cart</h1><div class="card"><p>${esc(msg)}</p><a href="/">← Back</a></div>`), MIME['.html']);
    if (!q.ok) return fail(q.errors.join(' '));
    if (f.priceCents != null && Number(f.priceCents) !== q.totalCents) {
      return fail('Prices were updated since you loaded the page. Please go back, refresh, and check the new price.');
    }
    const item = {
      productId: (cfg.cart && cfg.cart.productId) || 'custom-banner-sqft',
      materialId: q.material.id, materialName: q.material.name, ratePerSqFt: q.material.ratePerSqFt,
      widthFt: q.widthFt, heightFt: q.heightFt, sqft: q.sqft,
      materialCents: q.materialCents, setupCents: q.setupCents, totalCents: q.totalCents
    };
    if (!carts.has(sid)) carts.set(sid, []);
    carts.get(sid).push(item);
    return wantsJson(req) ? json(res, 200, { ok: true, item, redirect: '/cart' }) : redirect(res, '/cart');
  }

  if (req.method === 'GET' && p === '/cart') {
    const sid = session(req, res);
    return send(res, 200, cartPage(carts.get(sid) || [], loadConfig()), MIME['.html']);
  }

  if (req.method === 'POST' && p === '/cart/remove') {
    const sid = session(req, res);
    const body = await readBody(req);
    const items = carts.get(sid) || [];
    const i = Number(body.index);
    if (Number.isInteger(i) && i >= 0 && i < items.length) items.splice(i, 1);
    return redirect(res, '/cart');
  }

  if (req.method === 'POST' && p === '/checkout') {
    const sid = session(req, res);
    const items = carts.get(sid) || [];
    if (!items.length) return redirect(res, '/cart');
    const id = 'ORD-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const order = { id, createdAt: new Date().toISOString(), items, totalCents: items.reduce((s, i) => s + i.totalCents, 0) };
    fs.mkdirSync(ORDERS_DIR, { recursive: true });
    fs.writeFileSync(path.join(ORDERS_DIR, id + '.json'), JSON.stringify(order, null, 2));
    carts.delete(sid);
    return redirect(res, '/orders/' + id);
  }

  const orderMatch = /^\/orders\/(ORD-[A-Z0-9]+-[A-F0-9]{4})$/.exec(p);
  if (req.method === 'GET' && orderMatch) {
    const file = path.join(ORDERS_DIR, orderMatch[1] + '.json');
    if (!fs.existsSync(file)) return send(res, 404, 'Order not found');
    const o = JSON.parse(fs.readFileSync(file, 'utf8'));
    const cfg = loadConfig();
    const lines = o.items.map((i) => `<div class="line"><div><strong>${esc(i.materialName)}</strong><div class="meta">${esc(i.widthFt)} × ${esc(i.heightFt)} ft · ${esc(i.sqft)} sq ft</div></div><div>${money(i.totalCents, cfg)}</div></div>`).join('');
    return send(res, 200, page('Order confirmed', `<h1>Order confirmed</h1><p class="meta">Order <strong id="orderId">${esc(o.id)}</strong></p>
<div class="card">${lines}<div class="line tot"><span>Total</span><span id="orderTotal">${money(o.totalCents, cfg)}</span></div></div><a href="/">← Back to shop</a>`), MIME['.html']);
  }

  if (req.method === 'GET') {
    let rel = p === '/' ? '/index.html' : p === '/admin' ? '/admin.html' : p;
    const file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(rel)));
    if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
    if (fs.existsSync(file) && fs.statSync(file).isFile()) {
      return send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
    }
  }
  send(res, 404, 'Not found');
}

if (require.main === module) {
  http.createServer((req, res) => {
    handle(req, res).catch((e) => { console.error(e); if (!res.headersSent) json(res, 500, { error: 'Server error' }); });
  }).listen(PORT, () => {
    console.log(`Banner pricing running at http://localhost:${PORT}`);
    console.log(ADMIN_TOKEN ? `Admin editor: http://localhost:${PORT}/admin` : 'Admin saving disabled (set ADMIN_TOKEN to enable).');
  });
}

module.exports = { handle, validateConfig };
