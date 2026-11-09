// The Worker bundles .sql files as text (the "Text" rule in wrangler.jsonc).
declare module "*.sql" {
  const content: string;
  export default content;
}
