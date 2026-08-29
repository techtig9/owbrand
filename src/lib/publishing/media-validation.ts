const limits: Record<string, { maxBytes: number; mime: string[] }> = {
  image: {
    maxBytes: 20 * 1024 * 1024,
    mime: ["image/jpeg", "image/png", "image/webp"],
  },
  video: {
    maxBytes: 512 * 1024 * 1024,
    mime: ["video/mp4", "video/quicktime", "video/webm"],
  },
};

export function validateMedia(
  media: Array<{ mime: string; bytes: number }>,
  kind: "image" | "video",
) {
  const rule = limits[kind];

  return media.map((item) => ({
    ...item,
    valid:
      rule.mime.includes(item.mime) &&
      item.bytes > 0 &&
      item.bytes <= rule.maxBytes,
    reason: !rule.mime.includes(item.mime)
      ? "Unsupported MIME type"
      : item.bytes > rule.maxBytes
        ? "File exceeds configured size limit"
        : undefined,
  }));
}
