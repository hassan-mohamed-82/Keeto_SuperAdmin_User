# Shipping Company & Auto-Dispatch Architecture & Integration Flow
## 1. Overview
The Shipping Company system manages third-party logistics companies that provide outsource and shift-based couriers to service restaurants in Keeto.
### Source of Truth
- **Restaurant assignment**: `restaurant_settings.shipping_company_id` is the single source of truth.
  - Requirement: Allowed only when `home_delivery = true` AND `self_delivery = false`.
  - `shipping_company_restaurants` acts as an updated mirror table.
- **Courier type**: `work_type` (`restaurant_shift` | `outsource`). All couriers assigned to shipping companies have `delivery_type = 'outsource'`.
- **Courier zones**: Controlled by `all_zones` (boolean). If `true`, the courier services all company zones. If `false`, zones are defined in `delivery_man_zones`.
- **Authentication**: Users log in via `shipping_company_users` with roles `admin`, `dispatcher`, or `viewer`. Couriers log in via `delivery_men` with phone & password.
---
## 2. API Endpoints
### Super-Admin Routes (`/superadmin/shipping-companies`)
- `GET /` — List shipping companies with counts (zones, couriers, restaurants)
- `GET /eligible-restaurants` — List restaurants eligible for linking (`homeDelivery=true` and `selfDelivery=false`) with already-linked company indicator
- `POST /` — Create company (validates dispatch settings, links restaurants transactionally, creates first company admin in `shipping_company_users`)
- `GET /:id` — Detailed company info with `allZones`, `workType`, zones, and restaurants
- `PUT /:id` — Update company data, dispatch settings, and restaurants
- `DELETE /:id` — Soft-delete company (`status='inactive'`, deactivates company users, unlinks restaurants)
- `POST /:id/restaurants` — Assign restaurants transactionally (verifies not already linked to another company)
- `DELETE /:id/restaurants/:restaurantId` — Unlink a restaurant transactionally
### Shipping Company Portal Routes (`/shipping`)
- `POST /auth/login` — Rate-limited login via `shipping_company_users` (returns JWT with `shippingCompanyId`, `companyRole`, `tokenVersion`)
- `GET /auth/profile` — Get company details
- `GET /auth/me` — Get current logged-in user details
- **Company User Management (`/shipping/users`)** (Role: `admin` only):
  - `GET /` — List company users
  - `POST /` — Create user (`dispatcher` / `viewer` / `admin`)
  - Super-admins join `superadmin:room`.
- Customers and participants join `order:track:<orderId>` only with verified authorization.
### Courier Heartbeat & Tracking Flow
1. Courier emits `courier:online` upon startup.
2. Courier emits `courier:location` every 5 seconds:
   - Updates Redis GEO (`couriers:geo`).
   - Updates Redis alive key (`courier:alive:<id>`, TTL 60s).
   - Broadcasts to company dashboard live map (`delivery:location_changed`).
   - Broadcasts to active order customer tracking rooms (`order:courier_location`).
   - Persists to MySQL `delivery_men` table every 30 seconds as fallback.
3. On disconnect / `courier:offline`, a 30s grace period timer starts:
   - If reconnected within 30s, the timer is cleared.
   - If expired, courier is removed from Redis GEO and marked offline.
---
## 4. Dispatch Algorithm (8 Steps)
When a delivery order is moved to `accepted`:
1. **Check Restaurant Link**: Validates `restaurantSettings.shippingCompanyId`. If none, marks `manual_required` with `no_company` and alerts restaurant & admin.
2. **Check Company Status**: Verifies company is active. If inactive, marks `manual_required` with `company_inactive`.
3. **Point-In-Polygon Zone Match**: Confirms customer delivery coordinates fall inside an active zone. If missing coords, marks `no_coordinates`. If out of zone, marks `out_of_zone`.
4. **Max Attempts Check**: Checks `dispatchAttempts < company.maxAttempts`. If exceeded, marks `max_attempts`.
5. **Redis GEOSEARCH**: Finds couriers within `company.maxSearchRadius` of the restaurant branch, nearest first.
6. **Filtering**:
   - Belongs to same shipping company.
   - Active, online, not deleted.
   - `activeOrdersCount < company.maxActiveOrders`.
   - Has not rejected this order previously.
   - Alive key is active in Redis.
   - Zone match: `allZones == true` OR courier assigned to matched zone.
   - Work type match: `outsource` OR (`restaurant_shift` for this restaurant AND current time in shift window considering overnight shifts).
7. **Sorting (Decision D1)**:
   - Primary: Distance (`distanceKm ASC`).
   - Tie-break: `activeOrdersCount ASC`.
8. **Atomic Assignment**:
   - Acquires Redis mutex lock `lock:dispatch:<orderId>`.
   - Atomically updates order, increments `activeOrdersCount`, inserts `dispatch_assignments`.
   - Emits `order:assigned` to courier, shipping company, and customer tracking room.