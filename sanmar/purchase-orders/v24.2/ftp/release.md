---
id: sanmar.purchase-orders.ftp.release
title: Release.txt — Fields & Naming
version: v24.2
tags: [ftp, release, fields]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [19]
last_updated: 2025-09-08
---

- **Authorizes** processing of the paired `CustInfo.txt` + `Details.txt` batch.  
- Can be submitted up to **two weeks** after the pair.  
- **Naming** adds a **release number** suffix (e.g., `06-07-2022-1Release1.txt`, then `Release2.txt`, …).

| Field | Type/Limits | Req |
|---|---|---|
| `PONUM` | VARCHAR(28) | Y |
