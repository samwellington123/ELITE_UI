---
id: sanmar.web-services.errors
title: Error Codes & Messages
version: v24.2
tags: [errors, troubleshooting]
source_pdf: SanMar-Web-Services-Integration-Guide-24.2.pdf
source_pdf_page: 11
last_updated: 2025-09-08
---

## SanMar Standard — common errors

- **Invalid Style + Color + Size specified** — verify style, *mainframe* color, and size from the SDL file.
- **User authentication failed** — verify customer number, username, password.
- **Invalid warehouse specified** — use warehouse IDs: 1 Seattle; 2 Cincinnati; 3 Dallas; 4 Reno; 5 Robbinsville; 6 Jacksonville; 7 Minneapolis; 12 Phoenix; 31 Richmond.

## PromoStandards — common error codes

- `100` ID not found
- `104` Unauthorized for this service
- `105` Authentication failed
- `110` Credentials required
- `115` wsVersion not found
- `120` Required fields missing
- `130/135/140/145/150` Product/Part/Color/Size not found
- `155` Invalid date format
- `160` No results
- `200` Product data not found
- `300` queryType not found
- `301` Reference number not found (PO or Invoice; order must be shipped & invoiced)
- `302` Invalid shipmentDateTimeStamp range
- `303` Input date older than 7 days
- `999` General error
