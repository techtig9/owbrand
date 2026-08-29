import crypto from "crypto";

export function createPublishIdempotencyKey(
  postId: string,
  platform: string,
  scheduledFor?: string,
) {
  return crypto
    .createHash("sha256")
    .update(`${postId}:${platform}:${scheduledFor ?? "now"}`)
    .digest("hex");
}
