import { NextResponse } from "next/server";
import { logoutCurrentSession } from "@/lib/auth";
import { assertMutationOrigin, errorResponse } from "@/lib/http";

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    await logoutCurrentSession();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
