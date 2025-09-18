---
title: "Special Pricing File Columns"
id: "sanmar.ftp.pricing.special.fields"
tags: ["pricing", "fields"]
version: "v23.3"
source_pdf_page: [20]
last_updated: "2025-09-08"
---

# Special Pricing File Columns (CSV)

| # | Field | Description |
|---:|---|---|
| 1 | Inventory_Key | Product id |
| 2 | Size_Index | Size id |
| 3 | Catalog_No | Catalog number |
| 4 | Catalog_Color | Color |
| 5 | Size | Size |
| 6 | Piece_Weight | Lbs per piece |
| 7 | Piece_Price | Per-piece price (1–5) |
| 8 | Dozens_Price | Deprecated – Piece Price |
| 9 | Case_Price | Case price |
| 10 | Case_Size | Pieces per case |
| 11 | Each_sale_Price | Sale price per piece |
| 12 | Dozens_sale_price | Deprecated → Piece Price |
| 13 | Case_sale_price | Sale price per case |
| 14 | Sale_start_datetime | Sale start |
| 15 | Sale_end_datetime | Sale end |
| 16 | Unique_key | `INVENTORY_KEY+SIZE_INDEX` |
| 17 | Discontinued_code | `S`/`M` |
| 18 | My_price | Lowest available price (case or sale if no TVBP) |
