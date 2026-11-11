import { z } from "zod";

/** The longest name an agent can have, counted in UTF-16 code units after trimming. */
export const MAX_AGENT_NAME_LENGTH = 40;

/** The largest palette number and seed an agent's look takes; both are whole numbers from 0. */
export const MAX_LOOK_NUMBER = 2_147_483_647;

/**
 * How an agent's orb is drawn: which of the app's palettes (taken modulo how many the app has),
 * and the seed of its noise. The server only keeps it; the app draws it.
 */
export const lookSchema = z
  .object({
    palette: z.int().min(0).max(MAX_LOOK_NUMBER),
    seed: z.int().min(0).max(MAX_LOOK_NUMBER),
  })
  .meta({
    id: "Look",
    description:
      "How an agent's orb is drawn: one of the app's palettes, taken modulo how many the app has, and the seed of its noise",
  });

export type Look = z.infer<typeof lookSchema>;

/** A look picked at random, for an agent added without one. */
export function randomLook(): Look {
  const [palette = 0, seed = 0] = crypto.getRandomValues(new Uint32Array(2));
  return { palette: palette % (MAX_LOOK_NUMBER + 1), seed: seed % (MAX_LOOK_NUMBER + 1) };
}

/** What a user gives to add an agent: its name, and its look, picked at random when left out. */
export const newAgentSchema = z.object({
  name: z.string().trim().min(1).max(MAX_AGENT_NAME_LENGTH),
  look: lookSchema.optional(),
});

export type NewAgent = z.input<typeof newAgentSchema>;
