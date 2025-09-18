---
id: sanmar.web-services.standard.inventory
title: SanMar Standard — Product Inventory Service
version: v24.2
tags: [standard, inventory, warehouses]
source_pdf: SanMar-Web-Services-Integration-Guide-24.2.pdf
source_pdf_page: 60
last_updated: 2025-09-08
---

**WSDL**
- Test: `https://test-ws.sanmar.com:8080/SanMarWebService/SanMarWebServicePort?wsdl`
- Prod: `https://ws.sanmar.com:8080/SanMarWebService/SanMarWebServicePort?wsdl`

**Methods**
- `getInventoryQtyForStyleColorSize` — now supports **Style**, **Style/Color**, **Style/Size** bulk queries.
- `getInventoryQtyForStyleColorSizeByWhse` — return qty for a specific **warehouse**.

**Warehouses**
1 Seattle, 2 Cincinnati, 3 Dallas, 4 Reno, 5 Robbinsville, 6 Jacksonville, 7 Minneapolis, 12 Phoenix, 31 Richmond.

**Color param**
Uses **Catalog/Mainframe color** (not the display Color Name).
