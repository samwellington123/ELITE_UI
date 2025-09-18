---
id: sanmar.purchase-orders.processing
title: Order Processing, Testing & Production
version: v24.2
tags: [processing, testing, production, holding]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [12,14,20]
last_updated: 2025-09-08
---

## Order Processing Setup (hard-coded per account)
- SanMar Account Number
- Shipping Notification Email Address
- Shipping Label Company Name
- SanMar.com Username (for PO + optional invoice access)
- Shipping Option (Consolidation / Auto-split / Warehouse Selection)
- Payment Method (NET Terms or credit card last 4)

## Testing
- Submit a test order to **Test** and email the **PO number**; you will receive a **Holding.txt** acknowledgement showing warehouse and availability. Inventory/pricing may not match Production.  
- Use suggested test lines (styles/colors/sizes) from the guide.

## Production
- After test pass, Production setup in **24–48h**. Submit a small live order (FTP flat files or web services). Validate holding file and go-live.
- **Duplicate lines:** Consolidate duplicate product lines into one line with summed quantity to avoid sourcing issues.
