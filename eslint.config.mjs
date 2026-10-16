// ESLint nur für den Testlauf (GitHub): findet fehlende/unbenutzte Importe nach Umbauten
export default [{
  files: ['**/*.js'],
  languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: {
    window: 'readonly', document: 'readonly', navigator: 'readonly', location: 'readonly', history: 'readonly', fetch: 'readonly', console: 'readonly',
    setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly', clearInterval: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
    speechSynthesis: 'readonly', SpeechSynthesisUtterance: 'readonly', structuredClone: 'readonly', confirm: 'readonly', FileReader: 'readonly', Image: 'readonly',
    indexedDB: 'readonly', crypto: 'readonly', AbortSignal: 'readonly', L: 'readonly', Blob: 'readonly', caches: 'readonly', self: 'readonly', HTMLElement: 'readonly', getComputedStyle: 'readonly', requestAnimationFrame: 'readonly', localStorage: 'readonly', alert: 'readonly', createImageBitmap: 'readonly', OffscreenCanvas: 'readonly', Response: 'readonly', screen: 'readonly',
  } },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { args: 'none' }] },
}];
