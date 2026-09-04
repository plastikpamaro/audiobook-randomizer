import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createEpisode, getEpisodes } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { episodeInputSchema } from "@/lib/validation";

export async function GET() {
  try {
    const user = await requireApiUser();
    return NextResponse.json({ episodes: await getEpisodes(user.id) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const input = episodeInputSchema.parse(await jsonBody(request));
    return NextResponse.json({ id: await createEpisode(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
