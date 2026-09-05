import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";
import { previewImportSource } from "@/lib/online-import-service";

const schema = z.object({ sourceId: z.uuid() });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const { sourceId } = schema.parse(await jsonBody(request));
    return NextResponse.json(await previewImportSource(sourceId));
  } catch (error) {
    return errorResponse(error);
  }
}
