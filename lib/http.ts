import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { getAppOrigin } from "@/lib/env";
import { AppError } from "@/lib/app-error";

export { AppError } from "@/lib/app-error";

export function assertMutationOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin || origin.replace(/\/$/, "") !== getAppOrigin()) {
    throw new AppError("Die Anfrage stammt nicht von dieser Anwendung.", 403, "INVALID_ORIGIN");
  }
}

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return NextResponse.json(
      { error: error.message, code: error.code, details: error.details },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Bitte prüfe deine Eingaben.", code: "VALIDATION_ERROR", details: error.issues },
      { status: 422 },
    );
  }
  if (typeof error === "object" && error && "code" in error && error.code === "23505") {
    return NextResponse.json(
      { error: "Dieser Schlüssel oder Name wird bereits verwendet.", code: "DUPLICATE" },
      { status: 409 },
    );
  }
  if (typeof error === "object" && error && "code" in error && error.code === "23503") {
    return NextResponse.json(
      { error: "Der verknüpfte Datensatz wurde nicht gefunden oder wird noch verwendet.", code: "REFERENCE_CONFLICT" },
      { status: 409 },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: "Auf dem Server ist etwas schiefgegangen.", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}

export async function jsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("Die Anfrage enthält kein gültiges JSON.", 400, "INVALID_JSON");
  }
}
