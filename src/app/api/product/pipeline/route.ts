import { NextResponse } from "next/server";
import { buildProductPipeline } from "@/lib/product/product-pipeline";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!body.productId || !body.productName) {
      return NextResponse.json(
        { error: "productId and productName are required" },
        { status: 400 },
      );
    }

    return NextResponse.json(
      buildProductPipeline({
        productId: body.productId,
        productName: body.productName,
        sourceImages: Array.isArray(body.sourceImages) ? body.sourceImages : [],
        approvedFacts: body.approvedFacts ?? {},
        brandRules: body.brandRules ?? {},
      }),
    );
  } catch {
    return NextResponse.json({ error: "Unable to build product pipeline" }, { status: 500 });
  }
}
