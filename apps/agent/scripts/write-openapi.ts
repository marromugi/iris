// Prints the OpenAPI document for /api; `pnpm --filter @iris/agent-worker openapi` writes it to
// openapi.json, which the app's client is generated from. A test checks it is current.
import { agentApiDocument, PRODUCTION_ORIGIN } from "../src/api/api";

console.log(JSON.stringify(agentApiDocument(PRODUCTION_ORIGIN), null, 2));
