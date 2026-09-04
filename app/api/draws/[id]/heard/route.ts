import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { resolveDraw } from "@/lib/randomizer";
import { assertMutationOrigin, errorResponse } from "@/lib/http";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const { id } = await context.params;
    return NextResponse.json({ draw: await resolveDraw(user.id, id, "heard") });
  } catch (error) {
    return errorResponse(error);
  }
}
