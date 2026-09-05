import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { disableImportSource, updateImportSource } from "@/lib/online-import-service";

const schema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  url: z.url().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, "Mindestens ein Feld wird benötigt.");

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    await updateImportSource(id, schema.parse(await jsonBody(request)));
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
    await disableImportSource(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
