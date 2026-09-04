import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { deletePreset, savePreset } from "@/lib/catalog";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { presetInputSchema } from "@/lib/validation";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    await savePreset(user.id, presetInputSchema.parse(await jsonBody(request)), id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    await deletePreset(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
