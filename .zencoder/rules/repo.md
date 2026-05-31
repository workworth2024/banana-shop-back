# Banana Shop — Backend (banana-shop-back)

Node.js + Express (ESM) + MongoDB/Mongoose REST API under `/api/v3`.

## Tracking / Smart UTM Links feature

Affiliate-style tracking system: smart links with a unique base code (like a unique UTM id),
custom UTM params and addable `sub` key/value params. Tracks clicks, registrations and purchases
with attribution back to the acquiring link, plus geo + device (type/os/browser) breakdown.

### Models
- `models/TrackingLink.js` — `code` (crypto.randomBytes(5) hex unique id), `name`, `targetPath`,
  `utm{source,medium,campaign,term,content}`, `subs[{key,value}]`, `isActive`,
  `stats{clicks,uniqueVisitors,registrations,purchases,revenue}`.
- `models/TrackingEvent.js` — `linkId`, `linkCode`, `type` (`click|registration|order|service|preorder`),
  `visitorId`, `customerId`, `amount`, `geo` (2-letter country), `device{type,os,browser}`, `meta`.
  Indexes: `{linkId,type,createdAt}`, `{type,createdAt}`, `{createdAt}`.
- `models/CustomerUser.js` — has `acquisition{linkId,linkCode,utm,subs,geo,device{type,os,browser},landedAt}`.

### Utils — `utils/tracking.js`
- `parseDevice(ua)` → `{type,os,browser}`. `geoFromReq(req)` via geoip-lite.
- Cookies: `tl_ref` (link code), `tl_vid` (visitor id), 90 days.
- `recordClick` — writes click event + increments link stats.
- `attachAcquisition({user,code,req})` — first-touch attribution at registration. Stores acquisition
  (incl. device) on the customer + a `registration` event. **Skips if `!link.isActive`.**
- `recordPurchase({customerId,amount,orderType,orderId,...})` — idempotent per (linkId,type,meta.orderId).
  Resolves device via chain: `acquisition.device` → customer's registration event device. Backfills the
  customer's prior device-less purchase events. **Skips if `!link.isActive`.** orderType map:
  `order→order`, `service_order→service`, `preorder→preorder`.

### Controller — `controllers/trackingController.js`
- Public `hit` (POST /tracking/hit) — rejects unknown/inactive links (no click, no cookie set).
- Staff CRUD: `listLinks` (search + period stats via `perLinkStats`, affiliate filter via `buildLinkFilter`),
  `createLink`, `updateLink`, `deleteLink`, `getLinkStats`, `getDashboard`.
- `buildLinkFilter(query)` — maps `utm_source/medium/campaign/term/content` + `subKey/subValue`
  (subs via `$elemMatch`) to a TrackingLink filter (affiliate-style filtering).
- `deviceBreakdown(matchBase)` groups by `{type,os}` → rows `{device,os,clicks,registrations,purchases,revenue}`.
- `parseRange(req)` from `from`/`to` query.

### Routes — `routes/v3/trackingRoutes.js` (registered as `/tracking` in `routes/v3/index.js`)
- `POST /hit` public, rate-limited 60/min.
- `verifyToken` (staff) for `/dashboard`, `/links` CRUD, `/links/:id/stats`.

### Wiring
- `controllers/customerAuthController.js` — calls `attachAcquisition` on register + telegram new-user.
- `recordPurchase` is called next to every `creditReferralReward` in: digitalItemController,
  serviceOrderController, preorderController, orderController, cryptoCloudController (3 places).

## Conventions
- ESM modules, `STOREFRONT_URL` env for building link URLs.
- Do NOT add code comments unless asked.
