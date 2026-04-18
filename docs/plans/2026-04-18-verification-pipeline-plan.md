# Verification Pipeline Plan

## Goal

Make the repository verification pipeline usable for ongoing iteration by aligning the lint gate with the codebase's current warning baseline, while preserving a stricter command for future debt burn-down.

## Why this is next

- `pnpm test:run` is green
- `pnpm build` is green
- `pnpm lint` is still blocked by historical warnings spread across legacy surfaces
- As long as the default verification path is red for unrelated history, every future iteration is harder to trust

## Scope

- Keep ESLint errors blocking
- Stop historical warnings from failing the default `pnpm lint`
- Add a strict lint command that preserves the zero-warning target when we want to work the debt down intentionally
- Document the updated verification workflow in README

## Success Criteria

- `pnpm lint` passes
- `pnpm lint:strict` exists and fails on warnings
- `pnpm test:run` and `pnpm build` still pass after the change
