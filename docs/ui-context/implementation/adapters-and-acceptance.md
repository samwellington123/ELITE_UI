## API Adapters (Future Swap)

Standardize these functions so `api-mock.js` can be replaced with real API calls later:

- `getProducts({ customerEmail, quoteId }) => Promise<Array<Product>>`
- `createVersion({ quoteId, versionId, email }) => Promise<void>`
- `saveDesign({ quoteId, versionId, productId, manifest }) => Promise<void>`
- `renderPreview({ quoteId, versionId, productId, email }) => Promise<string /*url*/>`
- `calculateTax({ zip, items }) => Promise<{ taxAmount:number }>`
- `createCheckout({ customerInfo, products, quoteId, versionId }) => Promise<{ url:string }>`

## Acceptance Criteria

- Shared header/footer across pages; consistent tokens.
- Homepage CTA routes to `/quote` and passes `customerEmail` when available.
- Catalog filters and search operate client-side on `/mock/products.json`.
- Product detail surfaces pricing tiers and actions; related products load.
- Quote builder supports quantity edits, versioning, bbox modal, and mock previews.
- Admin page presents mock tools with state persisted to localStorage.


