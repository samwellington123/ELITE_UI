---
title: "Product Data Files – Overview"
id: "sanmar.ftp.product-data"
tags: ["product-data", "sdl", "epdd", "pdd", "catalog"]
version: "v23.3"
source_pdf_page: [9, 14]
last_updated: "2025-09-08"
---

# Product Data Files – Overview

Nightly updates complete by **6am PT** in the **`SanMarPDD`** FTP folder. Primary product files:

- **`SanMar_SDL_N.csv`** – basic product data, **no inventory**. Categories flattened; **no duplicate `UNIQUE_KEY`s**. Includes image URLs matching Data Library assets.  
- **`SanMar_EPDD.csv`** – basic product data **with bulk inventory**, split major/subcategories; may contain duplicate `UNIQUE_KEY`s due to category repeats. Includes image file names matching **EPDD.zip**.  
- **`SanMar_PDD` & Catalog files** – legacy-style product text with **GTINs** and extended descriptions.

> “Coming Soon” products may be incomplete until status changes to “New”.
