import type { AssistantMessage, Message } from "@iris/agent";
import { reset, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, test } from "vitest";
import { attachmentKey } from "../src/attachment";
import { MAX_IMAGE_BYTES_PER_REQUEST, MAX_IMAGES_PER_REQUEST, readImages } from "../src/runner";
import * as store from "../src/store";
import { modelRequests, scriptedModel } from "./worker";

afterEach(async () => {
  scriptedModel.length = 0;
  modelRequests.length = 0;
  await reset();
});

const USER_ID = "user-1";
const userAgent = () => env.USER_AGENT.getByName(USER_ID);

const reply = (text: string): AssistantMessage => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

async function firstAgentId(): Promise<string> {
  const [first] = await userAgent().listAgents();
  if (first === undefined) {
    throw new Error("The user has no agent.");
  }
  return first.id;
}

/** Puts up an image as the API does: its bytes in the bucket, unless `kept` is false, and its row. */
async function putUp(bytes: Uint8Array, kept = true): Promise<string> {
  const id = crypto.randomUUID();
  if (kept) {
    await env.ATTACHMENTS.put(attachmentKey(USER_ID, id), bytes);
  }
  await runInDurableObject(userAgent(), (_, state) =>
    store.insertAttachment(state.storage, {
      id,
      mediaType: "image/png",
      size: bytes.byteLength,
      createdAt: new Date(),
    }),
  );
  return id;
}

const images = (...ids: string[]) => ids.map((id) => ({ type: "image" as const, id }));

const MB = 1024 * 1024;

/** An image's row of `size` bytes, whose bytes the test reads as its ID. */
const sized = (size: number) => ({
  id: crypto.randomUUID(),
  mediaType: "image/png",
  size,
  createdAt: new Date(),
});

const read = async (id: string) => new TextEncoder().encode(id);

/** A post of only images. */
const post = (...ids: string[]): Message => ({ role: "user", text: "", images: images(...ids) });

test("a post's images reach the model by reference, with their bytes read for the call, and the run keeps only the references", async () => {
  const agentId = await firstAgentId();
  const first = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]);
  const second = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 2]);
  const ids = [await putUp(second), await putUp(first), await putUp(first, false)];

  const sent = await userAgent().sendMessage(agentId, { text: "", attachmentIds: ids });
  scriptedModel.push(reply("Two photos; the third didn't come through."));
  expect(await runDurableObjectAlarm(userAgent())).toBe(true);

  const opening: Message = { role: "user", text: "", images: images(...ids) };
  expect(modelRequests[0]?.messages).toEqual([opening]);
  expect(modelRequests[0]?.images).toEqual(
    new Map([
      [ids[0], { mediaType: "image/png", bytes: second }],
      [ids[1], { mediaType: "image/png", bytes: first }],
    ]),
  );
  expect(sent?.ok && sent.run.messages).toEqual([opening]);
  const [answered] = (await userAgent().recentRuns(agentId)) ?? [];
  expect(answered?.endedAt).not.toBeNull();
  expect(answered?.messages).toEqual([
    opening,
    reply("Two photos; the third didn't come through."),
  ]);
});

test("the images of an earlier post in the thread reach the model with the post", async () => {
  const agentId = await firstAgentId();
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 3]);
  const id = await putUp(bytes);
  await userAgent().sendMessage(agentId, { text: "My cat.", attachmentIds: [id] });
  scriptedModel.push(reply("A lovely cat."));
  await runDurableObjectAlarm(userAgent());

  await userAgent().sendMessage(agentId, { text: "What color is it?" });
  scriptedModel.push(reply("Gray."));
  await runDurableObjectAlarm(userAgent());

  expect(modelRequests[1]?.messages).toEqual([
    { role: "user", text: "My cat.", images: images(id) },
    reply("A lovely cat."),
    { role: "user", text: "What color is it?" },
  ]);
  expect(modelRequests[1]?.images).toEqual(new Map([[id, { mediaType: "image/png", bytes }]]));
});

test("a request carries the run's own images first, then earlier ones the latest first, as many as fit", async () => {
  const own = [sized(5 * MB), sized(5 * MB)];
  const oldest = sized(1 * MB);
  const older = sized(7 * MB);
  const latest = sized(4 * MB);
  const many = Array.from({ length: MAX_IMAGES_PER_REQUEST }, () => sized(1));

  const [byBytes, byCount] = await runInDurableObject(userAgent(), async (_, state) => {
    for (const attachment of [...own, oldest, older, latest, ...many]) {
      store.insertAttachment(state.storage, attachment);
    }
    return [
      await readImages(
        state.storage,
        [post(...own.map((a) => a.id))],
        [post(oldest.id), reply("…"), post(older.id), post(latest.id)],
        read,
      ),
      await readImages(state.storage, [post(...many.map((a) => a.id))], [post(oldest.id)], read),
    ];
  });

  // 5 + 5 + 4 + 7 would pass the limit; the oldest still fits after the one left out.
  expect(MAX_IMAGE_BYTES_PER_REQUEST).toBe(20 * MB);
  expect([...byBytes.keys()]).toEqual([...own, latest, oldest].map((a) => a.id));
  expect([...byCount.keys()]).toEqual(many.map((a) => a.id));
});
