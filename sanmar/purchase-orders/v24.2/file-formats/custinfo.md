---
id: sanmar.purchase-orders.files.custinfo
title: CustInfo.txt File Format
version: v24.2
tags: [ftp, files, custinfo]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: 18
last_updated: 2025-09-08
---

Contains **shipping information**.

Key fields:
- `PONUM` (varchar, required)
- `Address1` (varchar, required)
- `City`, `State`, `Zip` (required)
- `ShipMethod` (UPS/USPS, required)
- `ShipEmail` (varchar, required)
- `Residence` (Y/N, required)

Example: `FX34689,123 GRIFFITH ST,STE 202,CHARLOTTE,NC,28217,UPS,sales@abco.com,N,,,My Decorator,,DANA`
