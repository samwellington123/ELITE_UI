## Mocking Strategy

- Serve JSON from `public/mock/` and fetch with `fetch('/mock/...')`.
- Persist session state to `localStorage` using keys like:
  - `quote:{quoteId}`
  - `versionIndex:{quoteId}:{versionId}`
  - `design:{quoteId}:{versionId}:{productId}`
  - `preview:{quoteId}:{versionId}:{productId}` (data URL)
  - `logo:{email}`
  - `versionSelections`
- Client-side preview rendering: use `<canvas>` compositing to overlay logo into the drawn bbox; store data URL.
- Pricing: compute tier prices client-side based on mock tiers.
- Tax: default 0 or flat percent by ZIP (mock).


