---
id: sanmar.web-services.standard.product-info
title: SanMar Standard — Product Information Service
version: v24.2
tags: [standard, product, info, wsdl]
source_pdf: SanMar-Web-Services-Integration-Guide-24.2.pdf
source_pdf_page: 25
last_updated: 2025-09-08
---

**WSDL**
- Test: `https://test-ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort?wsdl`
- Prod: `https://ws.sanmar.com:8080/SanMarWebService/SanMarProductInfoServicePort?wsdl`

**Methods**
- `getProductBulkInfo` — generate full CSV in `SanMarPI` (FTP) ~20 minutes after request; use **monthly**.
- `getProductDeltaInfo` — generate delta CSV since last Bulk/Delta; use **daily**.
- `getProductInfoByBrand`
- `getProductInfoByCategory`
- `getProductInfoByStyleColorSize` (supports style / style-color-size / style-color / style-size)

**Notes**
- Use `unique_key` to upsert rows (combination of `INVENTORY_KEY` + `SIZE_INDEX`).
