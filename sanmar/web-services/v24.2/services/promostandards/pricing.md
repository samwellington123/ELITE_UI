---
id: sanmar.web-services.promostandards.pricing
title: PromoStandards — Pricing & Configuration
version: v24.2
tags: [promostandards, pricing, configuration]
source_pdf: SanMar-Web-Services-Integration-Guide-24.2.pdf
source_pdf_page: 81
last_updated: 2025-09-08
---

**WSDL**
- Test: `https://test-ws.sanmar.com:8080/promostandards/PricingAndConfigurationServiceBinding?WSDL`
- Prod: `https://ws.sanmar.com:8080/promostandards/PricingAndConfigurationServiceBinding?WSDL`

**Methods**
- `getConfigurationAndPricing` — Net/List/Customer special pricing; requires `fobId` and `configurationType=Blank`.
- `getFobPoints` — warehouse FOB points.
