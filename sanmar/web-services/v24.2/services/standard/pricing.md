---
id: sanmar.web-services.standard.pricing
title: SanMar Standard — Pricing Service
version: v24.2
tags: [standard, pricing, customer-pricing]
source_pdf: SanMar-Web-Services-Integration-Guide-24.2.pdf
source_pdf_page: 77
last_updated: 2025-09-08
---

**WSDL**
- Test: `https://test-ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort?wsdl`
- Prod: `https://ws.sanmar.com:8080/SanMarWebService/SanMarPricingServicePort?wsdl`

**Method**: `getPricing`
- Query via **style/color/size** *or* via **inventoryKey + sizeIndex**.
- Returns piece/dozen/case, sale, **myPrice** (customer-specific), incentive price, sale dates.
