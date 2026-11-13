/** The image types a post can carry, which the model reads. */
export const ATTACHMENT_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
] as const;

export type AttachmentMediaType = (typeof ATTACHMENT_MEDIA_TYPES)[number];

/** The largest image that can be put up, in bytes: the most the model takes in one image. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Where an image's bytes are kept in the ATTACHMENTS bucket. */
export function attachmentKey(userId: string, attachmentId: string): string {
  return `${userId}/${attachmentId}`;
}

/** The bytes of the user's image, or undefined when they aren't kept. */
export async function readAttachment(
  bucket: R2Bucket,
  userId: string,
  attachmentId: string,
): Promise<Uint8Array | undefined> {
  const object = await bucket.get(attachmentKey(userId, attachmentId));
  return object === null ? undefined : new Uint8Array(await object.arrayBuffer());
}

/** Whether `value` names one of the image types a post can carry. */
export function isAttachmentMediaType(value: string | undefined): value is AttachmentMediaType {
  return ATTACHMENT_MEDIA_TYPES.some((type) => type === value);
}

const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];

/** How each type's bytes start: a signature at an offset, any one of the lists for that type. */
const signatures: Record<AttachmentMediaType, readonly (readonly [number, number[]])[][]> = {
  "image/jpeg": [[[0, [0xff, 0xd8, 0xff]]]],
  "image/png": [[[0, [0x89, ...ascii("PNG\r\n"), 0x1a, 0x0a]]]],
  "image/gif": [[[0, ascii("GIF87a")]], [[0, ascii("GIF89a")]]],
  "image/webp": [
    [
      [0, ascii("RIFF")],
      [8, ascii("WEBP")],
    ],
  ],
};

/** Whether `bytes` start the way an image of `mediaType` does. */
export function looksLike(mediaType: AttachmentMediaType, bytes: Uint8Array): boolean {
  return signatures[mediaType].some((parts) =>
    parts.every(([offset, signature]) =>
      signature.every((byte, index) => bytes[offset + index] === byte),
    ),
  );
}
