---
id: sanmar.purchase-orders.files.details
title: Details.txt File Format
version: v24.2
tags: [ftp, files, details]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: 17
last_updated: 2025-09-08
---

Fields:
- `PONUM` (PO number) — varchar(28), required
- `INVENTORY_KEY` — SanMar Product ID (int, required)
- `QTY` — quantity (int, required)
- `SIZE_INDEX` — size ID (int, required)
- `WHSE_NO` — optional warehouse number

Example: `FX34689,1003,10,3`
