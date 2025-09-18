---
id: sanmar.purchase-orders.standard.getPreSubmitInfo
title: Web Services — getPreSubmitInfo
version: v24.2
tags: [standard, web-services, precheck, inventory, warehouse]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [22,25]
last_updated: 2025-09-08
---

Checks availability from the **closest warehouse** based on ship-to **State**; **does not** submit the order.

**Inputs (per line)**: either **`inventoryKey` + `sizeIndex`** *or* **`style` + `color (SANMAR_MAINFRAME_COLOR)` + `size`**.  
Returns message including **`whseNo`** when confirmed.

WSDL: `https://ws.sanmar.com:8080/SanMarWebService/SanMarPOServicePort?wsdl` (use `test-ws` for Test).
