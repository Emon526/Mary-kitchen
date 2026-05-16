---
name: project-features-batch1
description: Features implemented in the first major batch of changes — partial refunds, store profile, order transition graph, category cascade disable, dashboard time-range picker, scroll-to-top, dynamic nav.
metadata:
  type: project
---

Features shipped in this batch (branch: main, ~2026-05-15):

**Backend**
- `apps/store` — `StoreProfile` singleton (name, logo, address, hours, social links). Public endpoint `/api/v1/store/profile/`, admin PATCH `/api/v1/store/admin/profile/`. Logo file delete is post-commit safe.
- `apps/payments` — Partial refund support: `refund_payment()` now accepts `item_ids` (auto-computes amount) or explicit `amount` (cents). Row-locked transaction serialises concurrent requests. `Payment` gains `partially_refunded` status, `stripe_refund_id`, `refund_reason`.
- `apps/orders` — Proper state-machine (`VALID_TRANSITIONS` dict). `update_order_status` enforces forward-only transitions; `force=True` bypasses for admin override. Terminal statuses (refunded/cancelled) are immutable. Celery email enqueued via `on_commit`.  `Order.refunded_amount` + `OrderItem.refunded_quantity` fields track partial refunds.
- `AdminRefundStatsView` — `/api/v1/orders/admin/refund-stats/?days=N` returns total refunds + most-refunded products.
- `AdminDashboardStatsView` — now accepts `?days=N` (1–90), revenue uses net (total minus refunded), scoped to delivered orders.
- `AdminRevenueView` — `timezone.localdate()` fix; label format adapts (weekday for ≤7d, "Mon DD" for longer).
- `Category.save()` — cascade-disables all descendant categories and products when a category is deactivated.
- `AdminCategoryViewSet` — two new actions: `inactive-products` (GET), `activate-products` (POST with `activate_all` or `product_ids`).

**Frontend**
- `(admin)/admin/settings/` — Full store settings page: logo upload, brand, contact, address, coordinates, opening hours editor (per-day toggle + time, 24/7 shortcut), social links.
- `(admin)/admin/orders/` — Refund modal (by items / by amount / full), force-status-jump UI, status transition preview (current → next badge), skeleton loading, order-type pill badges, initials avatar.
- `(admin)/admin/page.tsx` — Time-range picker (7/14/30/90 days), refund analytics section (total refunds + most-refunded products), growth badge turns red when negative.
- `(admin)/admin/categories/` — Warning banner when disabling a category, post-reactivation product picker modal.
- `Header` — Dynamic nav categories from API, store logo from profile, close user menu on outside click, logout always redirects.
- `Footer` — Contact details from `StoreProfile`, social media icons (Facebook, Instagram, Website), safe URL validation.
- `contact/page.tsx` — Hours and contact cards populated from `StoreProfile`; 24/7 badge; closed-day rendering.
- `ScrollToTop` — Client component that fires `window.scrollTo` on pathname change.
- `ProductCard` / `product [slug]` — `object-contain` images, responsive `sizes`, fixed-height card image (no layout shift).
- `ReviewSection` — "Write a Review" button (collapsed by default), form expands on click.
- `useStoreProfile` hook — shared query key constant so cache invalidation works across components.

**Why:** Revenue metrics were counting paid-but-not-delivered orders; partial refund was not tracked; store name/contact were hardcoded.
**How to apply:** When editing refund, payment, or order status logic always check the state-machine in `services.py`. Store contact info is now dynamic — don't hardcode addresses in components.
