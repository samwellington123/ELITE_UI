---
id: sanmar.web-services.promostandards.product-data
title: PromoStandards — Product Data v2.0.0
version: v24.2
tags: [promostandards, product, data, v2.0.0]
source_pdf: SanMar-Web-Services-Integration-Guide-24.2.pdf
source_pdf_page: 40
last_updated: 2025-09-08
---

**WSDL**
- Test: `https://test-ws.sanmar.com:8080/promostandards/ProductDataServiceV2.xml?wsdl`
- Prod: `https://ws.sanmar.com:8080/promostandards/ProductDataServiceV2.xml?wsdl`

**Methods**
- `getProduct` — detailed product + GTIN/PMS/companions.
- `getProductCloseOut` — discontinued product/part IDs.
- `getProductDateModified` — changed since timestamp.
- `getProductSellable` — list sellable product/part IDs.
