import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { upsertPreference } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({ favorite: z.boolean().optional(), note: z.string().max(10_000).optional() }).refine(
  (value) => value.favorite !== undefined || value.note !== undefined,
  "Es wurde keine Änderung übergeben.",
);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    await upsertPreference(user.id, id, schema.parse(await jsonBody(request)));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
