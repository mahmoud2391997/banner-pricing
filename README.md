# Square-foot banner & sticker product page

The customer enters a width and height in feet and picks a material. The page then shows:

```
price = width × height × material rate ($/sq ft) + setup fee
```

Example: a 4 × 6 ft banner in 13 oz vinyl is 24 sq ft × $3.50 + $15 setup = **$99.00**.

## Run it

Requires Node 18 or newer. There are no dependencies to install.

```bash
ADMIN_TOKEN=choose-a-long-secret npm start     # http://localhost:3000
npm test
```

| Page | What it does |
|---|---|
| `/` | Product page. Prefill it with `/?w=4&h=6&material=vinyl-13oz` |
| `/admin` | Edit materials, rates, the setup fee, size limits and the product name. Saving needs `ADMIN_TOKEN` |
| `/cart`, `/checkout` | Built-in cart and checkout, for testing or as a stand-in |

## Changing prices without code

Open `/admin`, change names, rates or the setup fee, enter the admin token, and click **Save**. The change takes effect immediately on both the product page and the cart's price check. Unchecking **Show** hides a material from the dropdown without deleting it.

You can also edit `config/pricing.json` by hand. The server rereads it on every request.

## Connecting to your cart

`config/pricing.json` → `cart` controls how **Add to cart** sends the item:

```json
"cart": {
  "method": "form-post",          // "form-post" = normal form submit (most carts), "json-post" = fetch()
  "addUrl": "/cart/add",          // your cart's add-item URL
  "redirectTo": "/cart",          // where to go after a json-post
  "productId": "custom-banner-sqft",
  "fieldNames": { }               // rename any field to match your cart, e.g. { "price": "line_price" }
}
```

Fields sent (default names): `product_id`, `material_id`, `material_name`, `width_ft`, `height_ft`, `sqft`, `rate_per_sqft`, `setup_fee`, `price` (dollars, e.g. `99.00`), `price_cents`, and `description` (e.g. "13 oz Vinyl Banner — 4 × 6 ft (24 sq ft)").

### Don't trust the browser's price

A customer can edit any price sent from the browser. Your cart's add-item handler should recompute the price on the server before accepting it. Use one of these two approaches:

* **Call the quote API.** `POST /api/quote` with `{ "material_id", "width_ft", "height_ft" }` returns `totalCents`. Use that value and ignore the posted `price`.
* **Use the pricing code directly (Node).** `require('./public/assets/pricing-core.js').quote(config, {...})`.

The built-in `/cart/add` already does this. It rejects any item whose `price_cents` doesn't match the server's price.

### Embedding in an existing page

Copy `public/assets/{pricing-core.js,product.js,styles.css}` and the markup inside `<main>` from `public/index.html`. Set `data-config` on `<body>` to the URL of your pricing.json. If your site's CSS conflicts with the styles, scope `styles.css` under a wrapper class.

## Files

```
config/pricing.json          materials, rates, setup fee, limits, cart settings
public/index.html            product page
public/admin.html            pricing editor
public/assets/pricing-core.js pricing math shared by the browser and the server
public/assets/product.js     live calculator + add to cart
server.js                    static files, admin save, quote API, test cart/checkout
test/pricing.test.js         pricing tests (includes the 4 × 6 ft case)
```

## Live demo

Every push to `main` publishes a static demo to GitHub Pages
(`.github/workflows/pages.yml`). The calculator and material switching work
fully there. **Add to cart** only shows a demo notice, because GitHub Pages
can't run `server.js`. To use the cart, checkout and `/admin`, run the server
yourself or deploy it to a Node host.
