---
id: sanmar.purchase-orders.promostandards.sendpo
title: PromoStandards — sendPO
version: v24.2
tags: [promostandards, po, sendpo]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: 31
last_updated: 2025-09-08
---

Sends a purchase order to SanMar.

Required fields include: `wsVersion`, `id`, `password`, `orderType` ("Blank"), `orderNumber`, `orderDate`, `totalAmount`, `currency`, `shipReferences`, `lineItemArray` with `partId`, `quantity`, `uom`.

Response: transaction ID or error.
