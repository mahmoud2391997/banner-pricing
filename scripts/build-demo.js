#!/usr/bin/env node
// Builds the static demo site into _site/ (used by Vercel and GitHub Pages).
// The calculator is fully live; "Add to cart" shows a demo notice, since a
// static host can't run server.js (cart, checkout, admin).
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, '_site');

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
fs.rmSync(path.join(out, 'admin.html'), { force: true });
fs.rmSync(path.join(out, 'assets', 'admin.js'), { force: true });

const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'pricing.json'), 'utf8'));
config.cart = Object.assign({}, config.cart, { method: 'demo' });
fs.writeFileSync(path.join(out, 'pricing.json'), JSON.stringify(config, null, 2));

console.log('Built static demo in _site/');
