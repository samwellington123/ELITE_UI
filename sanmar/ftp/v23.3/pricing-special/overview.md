---
title: "Special Pricing – Daily/Delta/Incentive"
id: "sanmar.ftp.pricing.special"
tags: ["pricing", "delta", "incentive", "daily"]
version: "v23.3"
source_pdf_page: [19, 20]
last_updated: "2025-09-08"
---

# Special Pricing – Daily / Delta / Incentive

- **`sanmar_dp.csv`** – full catalog, **lowest available price** in `my_price`.  
- **`sanmar_dpc.csv`** – **Daily Delta** of changes only (first day seeds full catalog).  
- **`sanmar_dpIncentive.csv`** – full catalog with **program pricing** (`my_price` shows special price or 0 if none).

All are created **nightly after 2 AM PT** and dropped in your FTP Outbound folder.
