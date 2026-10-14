import { requireApiUser } from "@/lib/auth";
import { audioResponse } from "@/lib/audio";
import { errorResponse } from "@/lib/http";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

async function serve(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireApiUser();
    const { id } = await context.params;
    return await audioResponse(request, uuidSchema.parse(id));
  } catch (error) {
    const response = errorResponse(error);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  }
}

export const GET = serve;
export const HEAD = serve;
