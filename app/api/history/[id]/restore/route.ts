import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { restoreHeardDraw } from "@/lib/randomizer";
import { assertMutationOrigin, errorResponse } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    await restoreHeardDraw(user.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
