# Manga Translator Stabilization Plan

## Goal

Align the repository with the current product reality, lock the text-detection crop path with automated tests, and remove the most visible documentation/version drift before a full verification pass.

## Scope

- Add focused regression coverage for the crop-and-map translation path.
- Add explicit fallback coverage when text detection fails.
- Align extension/package versions.
- Rewrite top-level README sections that still describe the old product shape.
- Keep changes small, reversible, and limited to the current stabilization pass.

## Steps

1. Add focused translator tests for the crop path and fallback path.
2. Run the new tests first and confirm they fail for the right reason if needed.
3. Implement the minimum test-support or cleanup changes needed to make those tests pass cleanly.
4. Align `package.json` and `public/manifest.json` versioning.
5. Rewrite the top-level README so it matches the current architecture and user flow.
6. Run `pnpm test:run`, `pnpm build`, and `pnpm lint`, then fix anything that fails.

## Success Criteria

- The crop path is covered by an automated test that proves cropped image data is what reaches the provider and that coordinates are mapped back.
- The fallback path is covered by an automated test that proves translation still succeeds when text detection fails.
- Top-level docs no longer describe clearly outdated flows or files.
- Build, lint, and tests all pass at the end of the change.
