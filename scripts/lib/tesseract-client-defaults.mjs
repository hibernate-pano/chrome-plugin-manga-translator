/**
 * Remove tesseract.js's remote `workerPath` default from the client bundle.
 *
 * `src/services/text-detector.ts` always passes an explicit
 * `chrome.runtime.getURL('tesseract/worker.min.js')`, so the default is never
 * used at runtime. It is still a string in the package, and the Chrome Web
 * Store reviews the package: the Blue Argon finding quoted exactly this
 * template literal. A runtime override is not a defence against a static
 * scan.
 *
 * The value is replaced with a relative path rather than an empty string so
 * that the module stays a valid default. A caller that forgets to pass
 * `workerPath` gets a clear load failure from the page's own origin instead
 * of a silent download from a CDN. The extension's own caller always passes
 * the absolute extension URL.
 *
 * This is a Vite plugin rather than an edit to node_modules: the dependency
 * is installed fresh in CI, so the rewrite has to be part of the build. If
 * tesseract.js is upgraded and the template literal changes,
 * `patchClientDefaultOptions` throws instead of bundling the CDN default back
 * in.
 *
 * tesseract.js and tesseract.js-core are pinned to exact versions in
 * package.json for that reason: upgrading either one must re-run the
 * remote-code gate (`pnpm release:check`) and the OCR acceptance run on a
 * real browser (`evidence/cws-blue-argon/runtime-offline-ocr.mjs`). A caret
 * range would let a new upstream default reach the package without this
 * rewrite or those checks ever being revisited.
 */

const DEFAULT_OPTIONS_MODULE =
  '/tesseract.js/src/worker/browser/defaultOptions.js';

const REMOTE_WORKER_PATH =
  /`https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js@v\$\{version\}\/dist\/worker\.min\.js`/;

/**
 * Rewrite the browser default options module.
 *
 * @param {string} source
 * @returns {string}
 */
export function patchClientDefaultOptions(source) {
  const matches = source.match(REMOTE_WORKER_PATH) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one tesseract.js browser workerPath default, found ${matches.length}; ` +
        'the pinned tesseract.js changed — update patchClientDefaultOptions'
    );
  }

  const patched = source.replace(
    REMOTE_WORKER_PATH,
    "'tesseract/worker.min.js'"
  );
  if (patched.includes('cdn.jsdelivr.net')) {
    throw new Error(
      'the patched tesseract.js default options still contain a jsdelivr URL'
    );
  }
  return patched;
}

/**
 * Vite plugin that applies the rewrite before Rollup bundles the dependency.
 *
 * `enforce: 'pre'` matters: the package is CommonJS, and Vite's commonjs
 * plugin would otherwise rewrite the module before this hook sees the
 * template literal.
 *
 * @returns {import('vite').Plugin}
 */
export function localizeTesseractClientDefaults() {
  return {
    name: 'tesseract-local-client-defaults',
    enforce: 'pre',
    transform(code, id) {
      const cleanId = id.split('?')[0].replace(/\\/g, '/');
      if (!cleanId.endsWith(DEFAULT_OPTIONS_MODULE)) {
        return null;
      }
      return { code: patchClientDefaultOptions(code), map: null };
    },
  };
}
