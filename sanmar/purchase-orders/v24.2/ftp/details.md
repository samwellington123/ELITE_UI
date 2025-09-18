---
id: sanmar.purchase-orders.ftp.details
title: Details.txt — Fields
version: v24.2
tags: [ftp, details, fields]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [17]
last_updated: 2025-09-08
---

| Field | Type | Required | Notes |
|---|---|---|---|
| `PONUM` | VARCHAR(28) | Y | Purchase order number |
| `INVENTORY_KEY` | INT(6) | Y | SanMar product identifier (from **EPDD**) |
| `QTY` | INT(5) | Y | Quantity |
| `SIZE_INDEX` | INT(11) | Y | Size identifier |
| `WHSE_NO` | INT(2) | N | Warehouse number (**leave blank** unless on Warehouse Selection) |
