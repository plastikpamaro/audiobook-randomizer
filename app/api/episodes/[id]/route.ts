import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { setEpisodeArchived, updateEpisode } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { episodeInputSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    await updateEpisode(id, episodeInputSchema.parse(await jsonBody(request)));
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
    await setEpisodeArchived(id, true);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
