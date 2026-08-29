export interface CalendarItem {
  day: string;
  platform: string;
  format: "post" | "reel" | "story" | "email";
  objective: string;
  status: "draft";
}

export function build30DayCalendar(
  platforms: string[],
  primaryProduct = "featured product",
): CalendarItem[] {
  const formats: CalendarItem["format"][] = ["reel", "post", "story", "post"];
  const objectives = [
    `Educate about ${primaryProduct}`,
    `Show the value of ${primaryProduct}`,
    "Build trust with social proof",
    "Drive a clear CTA",
  ];

  return Array.from({ length: 30 }, (_, i) => ({
    day: `Day ${i + 1}`,
    platform: platforms[i % Math.max(platforms.length, 1)] ?? "instagram",
    format: formats[i % formats.length],
    objective: objectives[i % objectives.length],
    status: "draft",
  }));
}
