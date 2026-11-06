/*
 * Shared pricing logic. Loaded by the product page (browser) AND the server,
 * so the price the customer sees is exactly the price the cart accepts.
 *
 *   total = width_ft × height_ft × material rate ($/sq ft) + setup fee
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PricingCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toCents(dollars) {
    return Math.round(Number(dollars) * 100);
  }

  function activeMaterials(config) {
    return (config.materials || []).filter(function (m) { return m.active !== false; });
  }

  /**
   * @param config  contents of pricing.json
   * @param input   { widthFt, heightFt, materialId }
   * @returns { ok:false, errors:[] } or a full quote with all amounts in cents
   */
  function quote(config, input) {
    var limits = config.limits || {};
    var minFt = limits.minFt != null ? Number(limits.minFt) : 0.01;
    var maxW = limits.maxWidthFt != null ? Number(limits.maxWidthFt) : Infinity;
    var maxH = limits.maxHeightFt != null ? Number(limits.maxHeightFt) : Infinity;

    var w = Number(input.widthFt);
    var h = Number(input.heightFt);
    var errors = [];

    if (input.widthFt === '' || input.widthFt == null || !isFinite(w)) errors.push('Enter a width in feet.');
    else if (w < minFt) errors.push('Width must be at least ' + minFt + ' ft.');
    else if (w > maxW) errors.push('Width can be at most ' + maxW + ' ft.');

    if (input.heightFt === '' || input.heightFt == null || !isFinite(h)) errors.push('Enter a height in feet.');
    else if (h < minFt) errors.push('Height must be at least ' + minFt + ' ft.');
    else if (h > maxH) errors.push('Height can be at most ' + maxH + ' ft.');

    var material = activeMaterials(config).filter(function (m) { return m.id === input.materialId; })[0];
    if (!material) errors.push('Choose a material.');

    if (errors.length) return { ok: false, errors: errors };

    var sqft = w * h;
    var materialCents = Math.round(sqft * Number(material.ratePerSqFt) * 100);
    var setupCents = toCents(config.setupFee || 0);

    return {
      ok: true,
      widthFt: w,
      heightFt: h,
      sqft: Math.round(sqft * 100) / 100,
      material: { id: material.id, name: material.name, ratePerSqFt: Number(material.ratePerSqFt) },
      materialCents: materialCents,
      setupCents: setupCents,
      totalCents: materialCents + setupCents
    };
  }

  return { quote: quote, activeMaterials: activeMaterials, toCents: toCents };
});
