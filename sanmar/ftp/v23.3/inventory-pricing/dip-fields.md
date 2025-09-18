---
title: "sanmar_dip.txt Fields (Hourly)"
id: "sanmar.ftp.dip.fields"
tags: ["dip", "inventory", "warehouse", "hourly"]
version: "v23.3"
source_pdf_page: [15]
last_updated: "2025-09-08"
---

# `sanmar_dip.txt` Fields

Pipe-delimited; **updated hourly**.

| # | Field | Description |
|---:|---|---|
| 1 | Inventory_Key | Product id (with Size_Index forms a unique product) |
| 2 | Size_Index | Size id (with Inventory_Key forms a unique product) |
| 3 | Catalog_No | Style (e.g., K420) |
| 4 | Catalog_Color | Color |
| 5 | Size | Size |
| 6 | Whse_No | Warehouse: 1=Seattle, 2=Cincinnati, 3=Dallas, 4=Reno, 5=Robbinsville, 6=Jacksonville, 7=Minneapolis, 12=Phoenix, 31=Richmond |
| 7 | Quantity | **Max per warehouse displayed: 1500** |
| 8 | Piece_Weight | Lbs per piece |
| 9 | Piece_Price | Per-piece price (1–5) |
| 10 | Dozens_Price | Deprecated → Piece Price |
| 11 | Case_Price | Case price |
| 12 | Case_Size | Pieces per case |
| 13 | Each_sale_Price | Sale price per piece (if on sale) |
| 14 | Dozens_sale_price | Deprecated → Piece Price |
| 15 | Case_sale_price | Sale price per case (if on sale) |
| 16 | Sale_start_datetime | Sale start |
| 17 | Sale_end_datetime | Sale end |
| 18 | Unique_key | `INVENTORY_KEY+SIZE_INDEX` |
| 19 | Discontinued_code | `S`=SanMar / `M`=Mill |
| 21 | SALE_START_DATE | Sale start (alt) |
| 22 | SALE_END_DATE | Sale end (alt) |
