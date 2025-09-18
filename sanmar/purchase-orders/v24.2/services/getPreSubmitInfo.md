---
id: sanmar.purchase-orders.standard.getpresubmitinfo
title: Standard Web Service — getPreSubmitInfo
version: v24.2
tags: [web-services, standard, po, presubmit]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: 22
last_updated: 2025-09-08
---

Checks inventory availability by warehouse for a PO without submitting.

Key request fields: `poNum`, `shipAddress1/2`, `shipCity`, `shipState`, `shipZip`, `shipMethod`, plus line item info (`style`, `color`, `size`, `inventoryKey`, `sizeIndex`, `quantity`).

Returns confirmation if stock is available and warehouse number.
