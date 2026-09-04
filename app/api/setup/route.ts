import { NextResponse } from "next/server";
import { z } from "zod";
import { createOwnerAccount } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({
  email: z.email().max(320),
  password: z.string().min(12).max(200),
  setupToken: z.string().min(1).max(500),
});

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const body = schema.parse(await jsonBody(request));
    const user = await createOwnerAccount(body);
    return NextResponse.json({ user }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
