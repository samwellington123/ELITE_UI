## Development Principles

- Build entire UI with realistic mock behavior; swap real APIs later.
- Preserve existing quote builder flow as the revenue engine.
- Desktop-first; mobile functional but not primary.
- No auth required; admin tools are dev-only stubs.
- Static HTML/CSS/JS under `public/`; easy hosting and iteration.

### Tech Choices
- Static assets only during UI phase.
- Shared design tokens via CSS variables.
- Mock data via `public/mock/*.json`.
- Later, replace `api-mock.js` with real API adapters.


