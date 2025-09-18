## Risks / Constraints

- Client-side composite previews are approximations; not print-accurate.
- Mock JSON shapes must remain stable to simplify adapter swap.
- Without Neon, catalog size limited to shipped JSON; use pagination.

## Next Steps (Build Order)

1. Design system CSS and shared header/footer includes.
2. Homepage and navigation.
3. Catalog with filters/search/pagination (mock).
4. Product detail page.
5. Migrate/alias quote builder to `/quote`; wire mock adapters.
6. Contact and legal pages.
7. Admin page (mock tools + localStorage persistence).


