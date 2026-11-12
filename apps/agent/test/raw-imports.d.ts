// Vite's `?raw` suffix imports a file's text; the tests read wrangler.jsonc with it.
declare module "*?raw" {
  const text: string;
  export default text;
}
