import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { deleteEpisodeLink, updateEpisodeLink } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { linkInputSchema, uuidSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    await updateEpisodeLink(uuidSchema.parse(id), linkInputSchema.parse(await jsonBody(request)));
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
    await deleteEpisodeLink(uuidSchema.parse(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
