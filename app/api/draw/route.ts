import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { drawEpisode } from "@/lib/randomizer";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.union([
  z.object({ seriesIds: z.array(z.uuid()).min(1).max(100), presetId: z.never().optional() }),
  z.object({ presetId: z.uuid(), seriesIds: z.never().optional() }),
]);

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const body = schema.parse(await jsonBody(request));
    return NextResponse.json({ draw: await drawEpisode(user.id, body) });
  } catch (error) {
    return errorResponse(error);
  }
}
