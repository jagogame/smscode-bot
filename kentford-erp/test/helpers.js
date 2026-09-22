'use strict';
/* core.js ditulis sebagai script browser polos (const/function di top-level, tanpa
   module.exports) supaya bisa langsung dimuat lewat <script> tag di index.html tanpa build
   step. require() biasa di Node membungkusnya dalam function CommonJS sehingga semua const
   top-level jadi tidak terlihat dari luar. Di sini file aslinya (tanpa diubah sedikit pun)
   dijalankan lewat vm.runInContext ke dalam sandbox object supaya top-level const/function-nya
   nempel ke sandbox itu dan bisa dites langsung, persis seperti perilakunya di browser. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCore() {
  let src = fs.readFileSync(path.join(__dirname, '..', 'js', 'core.js'), 'utf8');
  // Top-level `const`/`let` in a vm context create bindings in the context's lexical
  // environment, not properties on the context object itself, so they would be invisible
  // to `sandbox.someConst` from outside the vm. Only `var`/function declarations attach to
  // the global object. This rewrite happens purely in the in-memory copy used for testing —
  // js/core.js on disk (what actually ships to the browser) is never touched.
  src = src.replace(/^const /gm, 'var ');
  const sandbox = {
    console,
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
      createElement: () => ({ style: {}, appendChild() {} }),
      head: { appendChild() {} }
    },
    localStorage: {
      _d: {},
      getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
      setItem(k, v) { this._d[k] = String(v); },
      removeItem(k) { delete this._d[k]; }
    },
    navigator: {},
    fetch: () => Promise.reject(new Error('no network in tests')),
    devicePixelRatio: 1
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: 'js/core.js' });
  return sandbox;
}

module.exports = { loadCore };
