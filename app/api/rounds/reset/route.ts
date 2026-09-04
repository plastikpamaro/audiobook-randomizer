import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { resetRounds } from "@/lib/randomizer";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({ seriesIds: z.array(z.uuid()).min(1).max(100) });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const body = schema.parse(await jsonBody(request));
    await resetRounds(user.id, body.seriesIds);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
