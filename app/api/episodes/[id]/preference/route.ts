import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { upsertPreference } from "@/lib/catalog";
import { AppError, assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({ favorite: z.boolean().optional(), note: z.string().max(10_000).optional(), expectedUserId: z.uuid().optional() }).refine(
  (value) => value.favorite !== undefined || value.note !== undefined,
  "Es wurde keine Änderung übergeben.",
);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    const { expectedUserId, ...input } = schema.parse(await jsonBody(request));
    if (expectedUserId !== undefined && expectedUserId !== user.id) {
      throw new AppError("Die Anmeldung hat sich geändert. Bitte lade die Seite neu.", 409, "SESSION_CHANGED");
    }
    await upsertPreference(user.id, id, input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
