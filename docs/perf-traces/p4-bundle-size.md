# P4 Bundle Size Report

Branch: `feat/p4-performance-polish`  
Build date: 2026-06-23  
Build command: `pnpm build`

## Size comparison (gzip)

| Entry            | P3b (baseline) | P4   | Δ        | Within ±5%? |
|------------------|----------------|------|----------|-------------|
| `dist/content.js` | 14.86 KB       | 14.46 KB | -0.40 KB (-2.7%) | ✓ |
| `dist/popup.js`   | 3.97 KB        | 3.97 KB  | 0        | ✓ |
| `dist/options.js` | 18.96 KB       | 19.14 KB | +0.18 KB (+0.9%) | ✓ |
| `dist/background.js` | 3.61 KB    | 3.61 KB  | 0        | ✓ |

## P4 changes by file

| File                                | Lines changed | Purpose                        |
|-------------------------------------|---------------|--------------------------------|
| `src/test/perf/*.bench.test.ts`     | +205          | New perf micro-benchmarks      |
| `src/content/floating-hud.ts`       | +7 / -2       | Progress transition 0.3s → 0.15s linear; ETA display; formatEta helper |
| `src/content/content.ts`            | +14 / -4      | Add etaSeconds to ContentState; computeEtaSeconds helper |
| `src/services/renderer.ts`          | +9 / -8       | Hover opacity 0.15 → 0.5 with transition; pin toggle 200ms cross-fade; fadein 0.3s → 0.2s |
| `src/components/Options/OptionsApp.tsx` | +32       | New CacheStatsCard component   |

**Net content.js delta: -0.40 KB gzip** — P4 is a small, lean improvement.

## What this PR does NOT change

- Bundle entry points (no new dynamic import)
- React vendor chunk (unchanged at 140.11 KB / gzip 45.00 KB)
- Background script (no protocol changes)
- Cache LRU implementation (existing 100-entry cap preserved)

## Manual perf trace

This PR does **not** include manual Chrome DevTools Performance traces.
Capturing those requires interactive load testing on a real machine with the
extension installed — they're typically run during the final QA pass before a
release, not in feature PRs.
