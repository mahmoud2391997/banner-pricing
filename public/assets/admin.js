(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var list = $('materials');
  var config;

  function slug(s) {
    return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'material';
  }

  function addRow(m) {
    var row = document.createElement('div');
    row.className = 'row';
    row.dataset.id = m.id || '';
    row.innerHTML =
      '<input class="name" placeholder="Material name" aria-label="Material name">' +
      '<input class="rate" type="number" min="0" step="0.01" placeholder="0.00" aria-label="Price per square foot">' +
      '<label class="active"><input type="checkbox" class="on"> Show</label>' +
      '<button type="button" class="remove" aria-label="Remove material">×</button>';
    row.querySelector('.name').value = m.name || '';
    row.querySelector('.rate').value = m.ratePerSqFt != null ? m.ratePerSqFt : '';
    row.querySelector('.on').checked = m.active !== false;
    row.querySelector('.remove').addEventListener('click', function () { row.remove(); });
    list.appendChild(row);
  }

  function collect() {
    var used = {};
    var materials = Array.prototype.map.call(list.children, function (row) {
      var name = row.querySelector('.name').value.trim();
      var id = row.dataset.id || slug(name);
      while (used[id]) id += '-2';
      used[id] = true;
      return {
        id: id,
        name: name,
        ratePerSqFt: Number(row.querySelector('.rate').value),
        active: row.querySelector('.on').checked
      };
    });
    var next = JSON.parse(JSON.stringify(config));
    next.productName = $('productName').value.trim();
    next.setupFee = Number($('setupFee').value || 0);
    next.limits = {
      minFt: Number($('minFt').value || 0.5),
      maxWidthFt: Number($('maxWidthFt').value || 16),
      maxHeightFt: Number($('maxHeightFt').value || 100)
    };
    next.materials = materials;
    return next;
  }

  function status(msg, ok) {
    var s = $('status');
    s.textContent = msg;
    s.className = 'status ' + (ok ? 'ok' : 'err');
  }

  $('addMaterial').addEventListener('click', function () { addRow({ active: true }); });

  $('save').addEventListener('click', function () {
    var body = collect();
    fetch('/admin/pricing', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': $('token').value },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().then(function (j) {
        if (!r.ok) throw new Error(j.error || 'Save failed');
        config = j.config;
        // New rows now have permanent ids.
        Array.prototype.forEach.call(list.children, function (row, i) { row.dataset.id = config.materials[i].id; });
        status('Saved ' + new Date().toLocaleTimeString(), true);
      });
    }).catch(function (e) { status(e.message, false); });
  });

  fetch('/pricing.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) {
    config = c;
    $('productName').value = c.productName || '';
    $('setupFee').value = c.setupFee || 0;
    var l = c.limits || {};
    $('minFt').value = l.minFt != null ? l.minFt : 0.5;
    $('maxWidthFt').value = l.maxWidthFt != null ? l.maxWidthFt : 16;
    $('maxHeightFt').value = l.maxHeightFt != null ? l.maxHeightFt : 100;
    (c.materials || []).forEach(addRow);
  }).catch(function () { status('Could not load current pricing.', false); });
})();
