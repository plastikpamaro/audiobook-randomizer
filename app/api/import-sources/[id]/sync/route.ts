import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse } from "@/lib/http";
import { syncImportSource } from "@/lib/online-import-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const { id } = await context.params;
    return NextResponse.json({ run: await syncImportSource(id, "manual") });
  } catch (error) {
    return errorResponse(error);
  }
}
