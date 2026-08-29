import { NextResponse } from "next/server";
import { FEATURE_MATRIX } from "@/lib/qa/feature-matrix";

export async function GET() {
  const summary = FEATURE_MATRIX.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json({
    total: FEATURE_MATRIX.length,
    summary,
    features: FEATURE_MATRIX,
  });
}
