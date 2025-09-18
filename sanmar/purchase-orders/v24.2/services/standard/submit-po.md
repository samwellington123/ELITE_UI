---
id: sanmar.purchase-orders.standard.submitPO
title: Web Services — submitPO
version: v24.2
tags: [standard, web-services, submit, po]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [26,28]
last_updated: 2025-09-08
---

Submits a PO for processing. Each line must include **`inventoryKey` + `sizeIndex`** or **`style` + `color (SANMAR_MAINFRAME_COLOR)` + `size`**.  
**Recommendation:** prefer inventoryKey/sizeIndex to reduce errors.

Response: `"PO Submission successful"` on success.
