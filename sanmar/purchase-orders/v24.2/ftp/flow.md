---
id: sanmar.purchase-orders.ftp.flow
title: FTP & Web Service File Processing Flow
version: v24.2
tags: [ftp, flow, folders]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [15]
last_updated: 2025-09-08
---

**Flow**: Create **CustInfo.txt** + **Details.txt** → upload to **In** → upload **Release.txt** to **Release** → system creates **Holding.txt** (ack) → all files move to **Done** when processed.

**Folders**
- **In**: `CustInfo.txt`, `Details.txt`
- **Release**: `Release.txt`
- **Holding**: `Holding.txt` (acknowledgement; shows warehouse and Y/N availability per line)
- **WaitingRelease**: CustInfo/Details moved here if no Release is uploaded
- **ErrorFiles**: invalid format/data
- **ResubmittedFiles**: duplicate file names detected (not processed)
