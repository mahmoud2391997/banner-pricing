(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var form = $('productForm');
  var widthEl = $('width');
  var heightEl = $('height');
  var materialEl = $('material');
  var addBtn = $('addBtn');
  var config, money, touched = false;

  // Field names sent to the cart. Override any of them in pricing.json → cart.fieldNames
  // to match what your cart expects (e.g. { "price": "line_price" }).
  var DEFAULT_FIELD_NAMES = {
    productId: 'product_id',
    materialId: 'material_id',
    materialName: 'material_name',
    widthFt: 'width_ft',
    heightFt: 'height_ft',
    sqft: 'sqft',
    ratePerSqFt: 'rate_per_sqft',
    setupFee: 'setup_fee',
    price: 'price',
    priceCents: 'price_cents',
    description: 'description'
  };

  function showErrors(list) { $('errors').textContent = list.join(' '); }
  function fmt(cents) { return money.format(cents / 100); }
  function num(n) { return Number(n).toLocaleString(config.locale || 'en-US', { maximumFractionDigits: 2 }); }

  function readInput() {
    return { widthFt: widthEl.value.trim(), heightFt: heightEl.value.trim(), materialId: materialEl.value };
  }

  function updatePreview(w, h) {
    var shape = $('previewShape');
    if (!(w > 0 && h > 0)) {
      shape.style.width = '60%'; shape.style.height = '60%';
      $('previewLabel').textContent = 'Your size';
      return;
    }
    var maxPct = 85, ratio = w / h;
    shape.style.width = (ratio >= 4 / 3 ? maxPct : maxPct * ratio * 0.75) + '%';
    shape.style.height = (ratio >= 4 / 3 ? maxPct / ratio * (4 / 3) : maxPct) + '%';
    $('previewLabel').textContent = num(w) + ' × ' + num(h) + ' ft';
  }

  function render() {
    $('notice').textContent = '';
    var input = readInput();
    var q = PricingCore.quote(config, input);
    var empty = input.widthFt === '' || input.heightFt === '';

    updatePreview(Number(input.widthFt), Number(input.heightFt));

    var mat = PricingCore.activeMaterials(config).filter(function (m) { return m.id === input.materialId; })[0];
    $('sumRate').textContent = mat ? money.format(mat.ratePerSqFt) + ' / sq ft' : '—';
    $('sumSetup').textContent = fmt(PricingCore.toCents(config.setupFee || 0));

    if (q.ok) {
      $('sumSqft').textContent = num(q.sqft) + ' sq ft';
      $('sumMaterial').textContent = fmt(q.materialCents);
      $('sumTotal').textContent = fmt(q.totalCents);
      showErrors([]);
    } else {
      $('sumSqft').textContent = '—';
      $('sumMaterial').textContent = '—';
      $('sumTotal').textContent = '—';
      // Don't nag about empty fields until the customer tries to add to cart.
      showErrors(empty && !touched ? [] : q.errors);
    }
    widthEl.setAttribute('aria-invalid', String(!q.ok && (touched || input.widthFt !== '') && q.errors.some(function (e) { return /width/i.test(e); })));
    heightEl.setAttribute('aria-invalid', String(!q.ok && (touched || input.heightFt !== '') && q.errors.some(function (e) { return /height/i.test(e); })));
    return q;
  }

  function buildPayload(q) {
    var cart = config.cart || {};
    var names = Object.assign({}, DEFAULT_FIELD_NAMES, cart.fieldNames || {});
    var data = {};
    data[names.productId] = cart.productId || 'custom-banner-sqft';
    data[names.materialId] = q.material.id;
    data[names.materialName] = q.material.name;
    data[names.widthFt] = String(q.widthFt);
    data[names.heightFt] = String(q.heightFt);
    data[names.sqft] = String(q.sqft);
    data[names.ratePerSqFt] = q.material.ratePerSqFt.toFixed(2);
    data[names.setupFee] = (q.setupCents / 100).toFixed(2);
    data[names.price] = (q.totalCents / 100).toFixed(2);
    data[names.priceCents] = String(q.totalCents);
    data[names.description] = q.material.name + ' — ' + num(q.widthFt) + ' × ' + num(q.heightFt) + ' ft (' + num(q.sqft) + ' sq ft)';
    return data;
  }

  function submitAsForm(url, data) {
    var f = document.createElement('form');
    f.method = 'POST';
    f.action = url;
    f.hidden = true;
    Object.keys(data).forEach(function (k) {
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = k; i.value = data[k];
      f.appendChild(i);
    });
    document.body.appendChild(f);
    f.submit();
  }

  function submitAsJson(url, data, redirectTo) {
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(data)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (body) {
        if (!r.ok) throw new Error(body.error || 'Could not add to cart (' + r.status + ').');
        window.location.href = body.redirect || redirectTo || '/cart';
      });
    });
  }

  function onSubmit(e) {
    e.preventDefault();
    touched = true;
    var q = render();
    if (!q.ok) return;
    var cart = config.cart || {};
    var data = buildPayload(q);
    if (cart.method === 'demo') {
      $('notice').textContent = 'Demo only: on the live store this adds "' + data[(cart.fieldNames || {}).description || 'description'] +
        '" at ' + fmt(q.totalCents) + ' to the cart.';
      return;
    }
    addBtn.disabled = true;
    addBtn.textContent = 'Adding…';
    if (cart.method === 'json-post') {
      submitAsJson(cart.addUrl, data, cart.redirectTo).catch(function (err) {
        showErrors([err.message]);
        addBtn.disabled = false;
        addBtn.textContent = 'Add to cart';
      });
    } else {
      submitAsForm(cart.addUrl, data);
    }
  }

  function init(cfg) {
    config = cfg;
    money = new Intl.NumberFormat(cfg.locale || 'en-US', { style: 'currency', currency: cfg.currency || 'USD' });

    if (cfg.productName) {
      $('productName').textContent = cfg.productName;
      document.title = cfg.productName;
    }

    var lim = cfg.limits || {};
    if (lim.minFt != null) { widthEl.min = lim.minFt; heightEl.min = lim.minFt; }
    if (lim.maxWidthFt != null) widthEl.max = lim.maxWidthFt;
    if (lim.maxHeightFt != null) heightEl.max = lim.maxHeightFt;
    var hint = [];
    if (lim.maxWidthFt != null) hint.push('Max width ' + lim.maxWidthFt + ' ft');
    if (lim.maxHeightFt != null) hint.push('max height ' + lim.maxHeightFt + ' ft');
    $('limitsHint').textContent = hint.join(', ') + (hint.length ? '.' : '');

    materialEl.innerHTML = '';
    PricingCore.activeMaterials(cfg).forEach(function (m) {
      var o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name + ' — ' + money.format(m.ratePerSqFt) + '/sq ft';
      materialEl.appendChild(o);
    });

    // Pre-fill from the URL, e.g. ?w=4&h=6&material=vinyl-13oz
    var params = new URLSearchParams(location.search);
    if (params.get('w')) widthEl.value = params.get('w');
    if (params.get('h')) heightEl.value = params.get('h');
    if (params.get('material')) materialEl.value = params.get('material');

    form.addEventListener('input', render);
    form.addEventListener('change', render);
    form.addEventListener('submit', onSubmit);
    render();
  }

  fetch(document.body.dataset.config || 'pricing.json', { cache: 'no-store' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(init)
    .catch(function () {
      showErrors(['Pricing is unavailable right now. Please refresh the page or contact us.']);
      addBtn.disabled = true;
    });
})();
