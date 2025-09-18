---
id: sanmar.web-services.best-practices
title: Integration Best Practices
version: v24.2
tags: [guidance, rates, usage, polling]
source_pdf: SanMar-Web-Services-Integration-Guide-24.2.pdf
source_pdf_page: 14
last_updated: 2025-09-08
---

### Data usage
SanMar does not enforce hard rate limits, but avoid excessive calls; prefer **hourly FTP files** (`sanmar_dip.txt`, `epdd.csv`) for catalog-wide refreshes; use **PromoStandards** methods for frequent polling.

### Pull cadence (highlights)
- **Invoices**: invoice once daily after **9pm PT**; pull **next day** (or after **3pm PT** for PromoStandards GetInvoices). Consider the **Daily Invoice File** on FTP (6am PT).
- **Inventory**: prefer `sanmar_dip.txt` (updated **hourly**) for bulk; use PromoStandards Inventory for live checks. Discontinued items show `quantity=0` and `discontinued_code=S`.
- **Pricing**: base/MSRP updated 1–2×/year; sale pricing **Mon/Wed**. Prefer `sanmar_dip.txt` (hourly).

### Order status & shipment notifications
Use **PromoStandards Order Status v2.0.0** ≤ **3×/day**; wait **2 hours** after PO submit; stop polling once header is *Complete* or *Canceled*. For shipments, prefer the nightly **Daily Status File** on FTP; or PromoStandards OSN v1.0.0 ≤ **3×/day**.
