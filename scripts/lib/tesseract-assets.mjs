/**
 * The Tesseract assets the extension ships, and the patch that makes them
 * local.
 *
 * `scripts/copy-tesseract.js` used to copy `worker.min.js` verbatim. That file
 * carries tesseract.js's own defaults: the core URL on jsdelivr, and the
 * language-data directory on jsdelivr. The extension overrode both at runtime,
 * but the Chrome Web Store reviews the package statically — the Blue Argon
 * finding quoted the default strings even though the running code never used
 * them. So the copy step now rewrites the two defaults into relative paths
 * that resolve inside `tesseract/`, and the artifact gate refuses any build
 * where a remote code URL survives.
 *
 * The patch is a string rewrite against a pinned dependency (tesseract.js
 * 7.0.0). If that package is upgraded and the minified expression changes,
 * `patchWorkerSource` throws instead of silently copying the CDN defaults
 * back in. The tests in `scripts/__tests__/tesseract-assets.test.mjs` pin
 * both the rewrite and that failure mode.
 */

/** Languages the OCR fallback recognizes, in the order the detector uses. */
export const TESSERACT_LANGUAGES = ['eng', 'jpn', 'chi_sim', 'kor'];

/** The version of the `@tesseract.js-data/*` packages, pinned in package.json. */
export const TESSERACT_DATA_VERSION = '1.0.0';

/**
 * Which traineddata variant tesseract.js selects for `createWorker(lang, 1)`.
 *
 * The second argument is OEM 1 (LSTM only), and the worker's own default is
 * `4.0.0_best_int` in that case. Shipping the same variant keeps OCR quality
 * identical to what the CDN used to serve.
 */
export const TESSERACT_DATA_VARIANT = '4.0.0_best_int';

/**
 * The core file `text-detector.ts` loads explicitly.
 *
 * Only the `.wasm.js` single-file build ships. It embeds the WebAssembly
 * binary as base64 and never fetches the sibling `.wasm`: the recorded OCR run
 * in `evidence/cws-blue-argon/runtime-network.json` shows
 * `tesseract-core-simd-lstm.wasm.js` being loaded and no `.wasm` request at
 * all. Copying the separate 2.86 MB binary put a file in `dist/` and in the
 * store ZIP that nothing could load, so it is deliberately absent here.
 */
export const TESSERACT_CORE_FILES = ['tesseract-core-simd-lstm.wasm.js'];

/** Where the worker script comes from inside node_modules. */
export const TESSERACT_WORKER_SOURCE = 'tesseract.js/dist/worker.min.js';

/** The package that provides one language's traineddata. */
export function trainedDataPackage(lang) {
  return `@tesseract.js-data/${lang}`;
}

/** The traineddata file inside that package. */
export function trainedDataRelativePath(lang) {
  return `${trainedDataPackage(lang)}/${TESSERACT_DATA_VARIANT}/${lang}.traineddata.gz`;
}

/**
 * Does a URL recorded at runtime name exactly this packaged asset?
 *
 * A substring test is not enough, and its failure mode is silent:
 * `.../tesseract-core-simd-lstm.wasm.js` contains
 * `.../tesseract-core-simd-lstm.wasm`, so an `includes` check reported the
 * separate `.wasm` as loaded whenever only the `.js` glue had been. That is
 * how the runtime acceptance script kept passing while the file it required
 * was dead weight.
 *
 * The scheme is checked too, so a remote URL that happens to end with the
 * same path cannot satisfy a check whose name says "from the extension".
 *
 * @param {string} url
 * @param {string} asset path relative to the extension root, e.g. `tesseract/worker.min.js`
 * @returns {boolean}
 */
export function urlLoadsExtensionAsset(url, asset) {
  if (typeof url !== 'string' || !url.startsWith('chrome-extension://')) {
    return false;
  }
  const pathname = url.split('#')[0].split('?')[0];
  const pathStart = pathname.indexOf('/', 'chrome-extension://'.length);
  if (pathStart === -1) {
    return false;
  }
  return pathname.slice(pathStart + 1) === asset;
}

/**
 * Rewrite tesseract.js's remote defaults to paths inside `tesseract/`.
 *
 * Two expressions are replaced:
 *
 *   1. `o||"https://cdn.jsdelivr.net/npm/tesseract.js-core@v".concat(h.substring(1))`
 *      becomes `o||"tesseract-core-simd-lstm.wasm.js"`. The explicit
 *      `corePath` still wins; the fallback now resolves relative to the
 *      worker script instead of the CDN.
 *
 *   2. `"https://cdn.jsdelivr.net/npm/@tesseract.js-data/".concat(i,m?"/4.0.0_best_int":"/4.0.0")`
 *      becomes `"lang"`, so the fallback is `lang/<lang>.traineddata.gz`
 *      relative to the worker — the directory `copy-tesseract.js` fills.
 *
 * The regexes are deliberately narrow. A broader "replace every jsdelivr URL"
 * would leave the `.concat(...)` tails behind and produce a path like
 * `lang/7.0.0`, which is not where the data lives.
 *
 * @param {string} source
 * @returns {string}
 */
export function patchWorkerSource(source) {
  const corePattern =
    /https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js-core@v"\.concat\([^)]*\.substring\(1\)\)/g;
  const langPattern =
    /"https:\/\/cdn\.jsdelivr\.net\/npm\/@tesseract\.js-data\/"\.concat\([^)]*\)/g;

  const coreMatches = source.match(corePattern) ?? [];
  const langMatches = source.match(langPattern) ?? [];

  if (coreMatches.length !== 1) {
    throw new Error(
      `expected exactly one tesseract core default, found ${coreMatches.length}; ` +
        'the pinned tesseract.js worker changed — update patchWorkerSource'
    );
  }
  if (langMatches.length !== 1) {
    throw new Error(
      `expected exactly one tesseract language-data default, found ${langMatches.length}; ` +
        'the pinned tesseract.js worker changed — update patchWorkerSource'
    );
  }

  let patched = source.replace(
    corePattern,
    'tesseract-core-simd-lstm.wasm.js"'
  );
  patched = patched.replace(langPattern, '"lang"');

  const remaining = patched.match(/https?:\/\/[^\s"'`]+/g) ?? [];
  if (remaining.length > 0) {
    throw new Error(
      `the patched worker still contains ${remaining.length} remote URL(s): ${remaining
        .slice(0, 3)
        .join(', ')}`
    );
  }

  if (!patched.includes('tesseract-core-simd-lstm.wasm.js')) {
    throw new Error('the patched worker lost its local core fallback');
  }
  if (!patched.includes('"lang"')) {
    throw new Error('the patched worker lost its local language-data fallback');
  }

  return patched;
}
