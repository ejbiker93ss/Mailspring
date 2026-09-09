# Styling new features for existing themes

New UI must work without theme authors adding selectors for it. Extend the closest existing component, not a separate hard-coded palette.

- Import `ui-variables` in every independently loaded LESS stylesheet, including files also imported by another stylesheet.
- Use the existing `.btn`, `.btn-emphasis`, input, list, and popover conventions. Nested account controls should retain the same spacing and font sizing as their adjacent fields.
- Pair surface and foreground colors: `@background-primary` with `@text-color`, inputs with `@input-bg`, links with `@text-color-link`, sidebar panels with `@source-list-bg`. Use `@border-color-divider`, `@border-radius-base`, and `@standard-shadow` for matching boundaries.
- Allow selected row contents to inherit the theme's selected foreground; do not force the ordinary foreground onto highlighted rows.
- Prefer semantic status colors as subtle backgrounds with the theme text color. Keep words/icons as well as color to convey status.
- Keep optional `--fm-*` properties derived from existing theme variables. Feature styles using them must have a legacy-token fallback. A theme should not need to define new custom properties to remain readable.
- Do not recolor actual email HTML, images, PDFs, or user-chosen calendar colors as part of UI theme compatibility.

Run `node scripts/test-theme-fallbacks.cjs` to compile the feature styles against the built-in light, dark, and legacy variable sets. Run with `--visual` for offline Edge fixtures and computed-color checks without newer `--fm-*` variables. The fixtures cover fallback behavior, not every third-party theme's selector overrides or the complete live application. Inspect the generated `.tmp-theme-*.png` files, especially light and dark.
