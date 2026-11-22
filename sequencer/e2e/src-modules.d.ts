// The app's own modules, imported inside page.evaluate: they run in the page, where Vite serves
// '/src/...'. tsc can't follow them from here (.svelte files, runes), so to it they're untyped.
declare module '/src/*';
