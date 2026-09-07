import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { recordManualListen } from "@/lib/randomizer";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({ episodeId: z.uuid(), requestId: z.uuid(), rating: z.number().int().min(1).max(10).nullable().optional() });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const input = schema.parse(await jsonBody(request));
    return NextResponse.json({ draw: await recordManualListen(user.id, input) });
  } catch (error) { return errorResponse(error); }
}
