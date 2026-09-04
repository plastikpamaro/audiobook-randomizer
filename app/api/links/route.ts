import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { createEpisodeLink, getEpisodeLinks } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { linkInputSchema, uuidSchema } from "@/lib/validation";

export async function GET(request: Request) {
  try {
    await requireApiUser();
    const episodeId = uuidSchema.parse(new URL(request.url).searchParams.get("episodeId"));
    return NextResponse.json({ links: await getEpisodeLinks(episodeId) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const input = linkInputSchema.parse(await jsonBody(request));
    return NextResponse.json({ id: await createEpisodeLink(input) }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
