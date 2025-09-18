---
id: sanmar.web-services.promostandards.inventory
title: PromoStandards — Inventory v2.0.0
version: v24.2
tags: [promostandards, inventory, v2.0.0]
source_pdf: SanMar-Web-Services-Integration-Guide-24.2.pdf
source_pdf_page: 67
last_updated: 2025-09-08
---

**WSDL**
- Test: `https://test-ws.sanmar.com:8080/promostandards/InventoryServiceBindingV2final?WSDL`
- Prod: `https://ws.sanmar.com:8080/promostandards/InventoryServiceBindingV2final?WSDL`

**Method**: `getInventoryLevels`
- Query types:
  1) by `productId` + `labelSize` + `partColor`
  2) by `productId` only
  3) by `partIdArray` (up to 200 per call; include any valid `productId` placeholder)
