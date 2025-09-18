---
id: sanmar.purchase-orders.shipping.options
title: Integrated Ordering Shipping Options
version: v24.2
tags: [shipping, options, consolidation, auto-split, warehouse-selection]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [11]
last_updated: 2025-09-08
---

### Option 1 — Warehouse Consolidation (Default)
- Try to ship complete from closest warehouse; auto-splits if necessary to fulfill. May delay ship time but reduces multi-warehouse freight.

### Option 2 — Auto-split Shipments (Requires account modification)
- Ships each line from closest available warehouse for speed; may incur additional shipping charges and can trigger manual intervention when a line cannot be fully fulfilled from one warehouse. Use **getPreSubmitInfo** to check availability before `submitPO` / `sendPO`.

### Option 3 — Warehouse Selection (Requires account modification; required for Will Call)
- You supply **warehouse number per line**; must track inventory to avoid holds. Missing stock causes order hold for manual keying.
