import { NextResponse } from "next/server";
import { z } from "zod";
import { changePassword, requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(12).max(200) });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const body = schema.parse(await jsonBody(request));
    await changePassword(user.id, body.currentPassword, body.newPassword);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
