---
id: sanmar.purchase-orders.shipping
title: Shipping Information & Methods
version: v24.2
tags: [shipping, will-call, psst, methods, cutoff]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [8,10]
last_updated: 2025-09-08
---

## Shipping Info
- Use SanMar UPS account at **standard rates**, or your own account (may delay processing).  
- See **warehouse locations** and **cutoff times** on sanmar.com.  
- **Free Freight:** Orders over **$200** via **ground** with SanMar’s preferred carrier (CONUS), excluding bags/oversized travel bags.

## PSST (Pack Separately. Ship Together.)
- PSST decorator orders cutoff is **1pm** from your primary warehouse. Ship-to address must **exactly match** SanMar's record to avoid delays.

## Ship Methods (Standard & PromoStandards)
- UPS: Ground, 2ND DAY, 2ND DAY AM, 3RD DAY, NEXT DAY, NEXT DAY SV, NEXT DAY EA, SATURDAY
- USPS: **PP** (Ground Advantage), **APP** (Priority Mail)
- **PSST** (program)
- **Will Call** (warehouse codes): PRE(1), CIN(2), COP(3), REN(4), NJE(5), JAC(6), MSP(7), PHX(12), VA1(31) — use the **warehouse code** in `shipMethod` or CustInfo line.
