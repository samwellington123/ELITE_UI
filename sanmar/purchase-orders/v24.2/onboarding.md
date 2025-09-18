---
id: sanmar.purchase-orders.onboarding
title: Onboarding & Establishing PO Integration
version: v24.2
tags: [onboarding, authentication, test, production]
source_pdf: SanMar-Purchase-Order-Integration-Guide-24.2.pdf
source_pdf_page: [3,5]
last_updated: 2025-09-08
---

## FTP / Web Services Onboarding
1. Email **sanmarintegrations@sanmar.com** with your request and **SanMar Customer Number**.
2. Sign **Integration Agreement** (no fee; must be an authorized signatory).
3. Access (FTP/Web Services) is typically enabled **within 1–2 business days** with instructions and a secure link to credentials.  
   **Note:** FTP credentials are **different** from Web Services; **SanMar.com** username/password authenticate **production** Standard & PromoStandards APIs.

## Purchase Order Integration Onboarding
1. After verifying product data access, request **PO integration**.
2. SanMar provisions a **Test** account in **2–3 business days** and shares one-time **Web Services Test** credentials.
3. Complete testing using a **production-intent address** and submit an order with **multiple lines**; additional testing may apply for **PSST**.
4. Email your **test PO #** to **sanmarintegrations@sanmar.com** for review.
5. After test pass, provide **username**, **shipping info**, and **payment method** for **production** setup (**~1–2 business days**).

## Authentication
- **Standard (prod)**: `sanMarCustomerNumber` (INT), `sanMarUserName`, `sanMarUserPassword`.
- **PromoStandards (prod)**: `id` (SanMar.com username), `password` (SanMar.com password).
- **Test**: email Integration Support with account number + reason to obtain credentials.  
- **Auth response** includes `errorOccurred` (BOOLEAN) and `message`.
