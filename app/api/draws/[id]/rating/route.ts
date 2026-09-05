import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { setDrawRating } from "@/lib/randomizer";

const schema = z.object({ score: z.number().int().min(1).max(10).nullable() });

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const { score } = schema.parse(await jsonBody(request));
    await setDrawRating(user.id, id, score);
    return NextResponse.json({ ok: true, score });
  } catch (error) {
    return errorResponse(error);
  }
}
