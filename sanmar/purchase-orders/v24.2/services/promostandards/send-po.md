---
id: sanmar.purchase-orders.promostandards.sendPO
title: PromoStandards — sendPO
version: v24.2
tags: [promostandards, sendpo, shipment, contacts]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [31,36]
last_updated: 2025-09-08
---

Sends a configured PO. Supply `wsVersion`, `id`, `password`, and a `PO` object with **OrderContactArray**, **ShipmentArray** (incl. `carrier` and `service` like UPS **GROUND/2ND DAY/…** or USPS **PP/APP**), and **LineItemArray** with `partId` (Unique_Key) and `Quantity` (`uom` like **EA**, **PK**, **CA**, etc.).

Response includes a **transactionId** containing your `orderNumber` on success.
