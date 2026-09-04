import { NextResponse } from "next/server";
import { z } from "zod";
import { loginWithPassword } from "@/lib/auth";
import { assertMutationOrigin, errorResponse, jsonBody } from "@/lib/http";

const schema = z.object({ email: z.email().max(320), password: z.string().min(1).max(200) });

export async function POST(request: Request) {
  try {
    assertMutationOrigin(request);
    const body = schema.parse(await jsonBody(request));
    const user = await loginWithPassword(request, body.email, body.password);
    return NextResponse.json({ user });
  } catch (error) {
    return errorResponse(error);
  }
}
