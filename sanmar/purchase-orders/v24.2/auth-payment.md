---
id: sanmar.purchase-orders.auth
title: Authentication & Payment
version: v24.2
tags: [auth, payment, credentials]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: 5
last_updated: 2025-09-08
---

## Authentication

**Standard Web Services** require: `sanMarCustomerNumber`, `sanMarUserName`, `sanMarUserPassword`.  
**PromoStandards Web Services** require: `id` (SanMar.com username), `password` (SanMar.com password).

Test credentials: request by emailing **sanmarintegrations@sanmar.com** with your account number and reason.

**Response fields:**  
- `errorOccurred` (boolean)  
- `message` ("ERROR: User authenticating failed" if error)

## Payment Methods

- Must have **NET terms** or **credit card on file** at sanmar.com.
- Apply at [sanmar.com/resources/newcustomer/creditapp](https://www.sanmar.com/resources/newcustomer/creditapp).
