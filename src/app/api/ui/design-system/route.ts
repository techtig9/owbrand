import { NextResponse } from "next/server";
import { DESIGN_TOKENS } from "@/lib/ui/design-tokens";
import { UI_COMPONENTS } from "@/lib/ui/components";
import { ACCESSIBILITY_RULES } from "@/lib/ui/accessibility";

export async function GET() {
  return NextResponse.json({
    tokens: DESIGN_TOKENS,
    components: UI_COMPONENTS,
    accessibility: ACCESSIBILITY_RULES,
  });
}
