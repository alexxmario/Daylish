# Illustration assets

Drop generated PNGs here using the exact filenames in
[`docs/illustration-brief.md`](../../../../docs/illustration-brief.md), then add
the matching `require(...)` line to
`apps/mobile/src/illustrations/registry.ts` → `ILLUSTRATION_SOURCES`.

Until a file is registered, the app draws a procedural placeholder from the
palette — so a missing image is never a broken screen.
