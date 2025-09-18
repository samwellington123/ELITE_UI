---
id: sanmar.purchase-orders.ftp.custinfo
title: CustInfo.txt — Fields
version: v24.2
tags: [ftp, custinfo, fields]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [18]
last_updated: 2025-09-08
---

> **Do not include commas** inside field values (commas are the delimiter).

Key fields (subset):

| Field | Type/Limits | Req | Notes |
|---|---|---|---|
| `PONUM` | VARCHAR(28) | Y | PO number |
| `ADDRESS_1` | VARCHAR(35) | Y | Use street abbreviations: ST, AVE, RD, DR, BLVD |
| `ADDRESS_2` | VARCHAR(35) | N | Suite/APT |
| `CITY` | VARCHAR(28) | Y |  |
| `STATE` | VARCHAR(2) | Y | 2-letter |
| `ZIP_CODE` | 5–10 (numeric/ZIP+4) | Y | Accepts `XXXXX`, `XXXXX-XXXX`, or `XXXXXXXXX` |
| `SHIP_METHOD` | VARCHAR(15) | Y | e.g., UPS/USPS/PSST or warehouse code for Will Call |
| `SHIP_TO_EMAIL` | VARCHAR(105) | Y | confirmations + tracking |
| `RESIDENCE` | VARCHAR(1) | Y | `Y` or `N` |
| `CO_NAME` | VARCHAR(28) | N | Company name |
| `ATTENTION` | VARCHAR(35) | N | Receiver or PO ref |
