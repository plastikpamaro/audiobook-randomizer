import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { skipAndDrawNext } from "@/lib/randomizer";
import { assertMutationOrigin, errorResponse } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    const user = await requireApiUser();
    const id = uuidSchema.parse((await context.params).id);
    return NextResponse.json({ draw: await skipAndDrawNext(user.id, id) });
  } catch (error) {
    return errorResponse(error);
  }
}
