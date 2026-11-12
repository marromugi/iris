import { env as workerEnv } from "cloudflare:workers";
import { createApp } from "./app";
import { modelProviderOf, modelProviders } from "./model-provider";
import { bashTool } from "./sandbox/bash-tool";
import { countSearch, findMail, listMail } from "./store";
import { browserRun, browserTools } from "./web/browser";
import { exaSearcher, searchTool } from "./web/search";
import { mailTools } from "./mail/mail-tools";
import { receiveMail } from "./mail/receive";
import { createUserAgent } from "./user-agent";

// Every export of this module is an entrypoint the runtime starts: the Durable Object classes, the
// S3 gateway the sandboxes' mounts go through, and the fetch and email handlers, nothing else.

// Read when the Worker starts, so a value it doesn't know stops the Worker from starting instead
// of failing each run.
const provider = modelProviders[modelProviderOf(workerEnv.MODEL_PROVIDER)];

export const UserAgent = createUserAgent(
  (env) => ({ model: provider.model(env), modelName: provider.modelName, tools: [] }),
  (env, { agentId }, storage) => {
    const browser = browserRun(env.BROWSER);
    return {
      tools: [
        bashTool({ run: (command) => env.AGENT_SANDBOX.getByName(agentId).run(agentId, command) }),
        searchTool(
          exaSearcher(env.AI),
          { count: (month) => countSearch(storage, month) },
          () => new Date(),
        ),
        ...browserTools(browser),
        ...mailTools(
          {
            list: (range, limit) => listMail(storage, range, limit),
            find: (id, after) => findMail(storage, id, after),
          },
          () => new Date(),
        ),
      ],
      release: () => browser.close(),
    };
  },
);
export type UserAgent = InstanceType<typeof UserAgent>;

export { S3Gateway } from "@cloudflare/sandbox";
export { AgentSandbox } from "./sandbox/agent-sandbox";

const app = createApp(workerEnv.ORIGIN);

export default {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
  email: (message, env) =>
    receiveMail(
      message,
      env.DB,
      {
        keep: (userId, mail) => env.USER_AGENT.getByName(userId).keepMail(mail),
        confirm: (userId, confirmation) =>
          env.USER_AGENT.getByName(userId).keepMailConfirmation(confirmation),
      },
      () => new Date(),
    ),
} satisfies ExportedHandler<Env>;
