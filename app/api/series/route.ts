import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createSeries, getSeriesOverview } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { seriesInputSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ series: await getSeriesOverview(user.id, true) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const input = seriesInputSchema.parse(await jsonBody(request));
    return NextResponse.json({ id: await createSeries(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
