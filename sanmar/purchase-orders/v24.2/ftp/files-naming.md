---
id: sanmar.purchase-orders.ftp.files
title: FTP Text Files — Naming & Timing
version: v24.2
tags: [ftp, files, naming, timing]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [16]
last_updated: 2025-09-08
---

**Three files** (comma-delimited ASCII; filenames **capitalized**): `CustInfo.txt`, `Details.txt`, `Release.txt`.

**File naming (date + batch + filename)**  
- Date format: **MM-DD-YYYY**  
- Batch number: incremental per day (`-1`, `-2`, …).  
- Examples: `06-07-2022-1CustInfo.txt`, `06-07-2022-1Details.txt`, `06-07-2022-1Release.txt`.

**Submission timing**
- Upload **CustInfo + Details** first, then **Release** after a short delay to avoid timing errors.
