import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiUser } from "@/lib/auth";
import { previewCsv } from "@/lib/import-service";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({ csv: z.string().min(1).max(10_000_000) });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    await requireApiUser(["owner", "admin"]);
    const { csv } = schema.parse(await jsonBody(request));
    return NextResponse.json(previewCsv(csv));
  } catch (error) {
    return errorResponse(error);
  }
}
