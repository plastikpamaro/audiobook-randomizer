import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { updateSeries } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { seriesInputSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    const input = seriesInputSchema.partial().parse(await jsonBody(request));
    await updateSeries(id, input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    await updateSeries(id, { archived: true });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
