## Quote Builder (`/quote`)

### Components
- Product grid with pricing tiers and quantity controls.
- Design version dropdown per product.
- BBox modal: draw rectangle, inches overlay if zones present, save version.
- Sidebar totals with tax estimate and checkout button (mock).

### URL Params
- `?quoteId=`
- `?customerEmail=`
- `?bboxToken=directum-bbox-setup`

### Mock Logic
- Save design/version to localStorage; render preview via canvas to data URL.
- Tax estimate: 0 by default or flat percent if ZIP provided.


