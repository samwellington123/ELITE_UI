---
title: "PDD & Catalog Text Files (with GTINs)"
id: "sanmar.ftp.pdd.catalog"
tags: ["pdd", "catalog", "gtin", "text-files"]
version: "v23.3"
source_pdf_page: [13, 14]
last_updated: "2025-09-08"
---

# PDD & Catalog Text Files (with GTINs)

## `sanmar_pdd.txt` (pipe-delimited)
Core columns include: `inventory_key`, `catalog_no`, `mill`, `mill_style_no`, `catalog_color`, `size`, `description`, `extended_description`, `ea_price`, `case_price`, `case_qty`, `weight`, `size_type`, `size_index`, `gtin`.

## `Catalog.txt` (tab-delimited)
Mirrors the above with uppercase headers and includes `GTIN`.

## `sanmar_activeproductsexport.txt` (pipe-delimited)
Adds **per-warehouse** fields: `Whse_No`, `Quantity` (max per-whse cap), plus price and case details.
