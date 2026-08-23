# ⚠️ DEPRECATED — Manga OCR-First Server

**Status:** Frozen as of v0.7.0. Not maintained. Will be removed in v1.0.

This Python backend is the OCR-first path that the plugin **no longer ships**
as a default. The plugin's `full-image-vlm` pipeline (VLM does everything in
one pass) handles all the cases this server used to handle, with less
operational overhead and zero local Python install.

## Why is this still here?

Two reasons, both temporary:

1. **Backwards compatibility.** A small number of existing users have the
   plugin configured to call this server. We're keeping it alive long enough
   for those users to migrate to direct provider paths.
2. **Migration window.** Anyone who wants to keep using OCR-first translation
   should be able to fork this code into a separate repository and ship their
   own version. We'll publish the migration plan as part of v1.0.

If you arrived here from a search result: please ignore this directory and
use the plugin's direct provider paths instead. The plugin is faster, simpler,
and doesn't require a Python install.

## What was here

For historical reference, this server provided:

- PaddleOCR + MangaOCR text detection
- Region-level VLM fallback translation
- Per-block text translation (DeepL / Google / Baidu)
- SQLite + filesystem cache

The plugin's `services/translator.ts` and the providers in `src/providers/`
now cover the same surface area without the server hop.

## Forks

If you fork this code into a separate project, please:

- Drop the `Manga Translator` name from your branding — it's ours.
- Don't reuse the API contracts in `src/shared/runtime-contracts.ts`
  verbatim — they may change.
- Open an issue to let us link to your project from the main repo's README.

— The Manga Translator maintainers
