import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const unauthorized = (msg = "Unauthorized") => new HttpError(401, msg);
export const forbidden = (msg = "Forbidden") => new HttpError(403, msg);
export const notFound = (msg = "Not found") => new HttpError(404, msg);
export const badRequest = (msg = "Bad request") => new HttpError(400, msg);
export const conflict = (msg = "Conflict") => new HttpError(409, msg);

// Maps thrown errors to a JSON response. Auth guards throw plain Errors prefixed
// with "Unauthorized" / "Forbidden", so those prefixes are honoured too.
export function toErrorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: "Validation failed", issues: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
      { status: 400 }
    );
  }
  const message = err instanceof Error ? err.message : "Unknown error";
  if (message.startsWith("Unauthorized")) return NextResponse.json({ error: message }, { status: 401 });
  if (message.startsWith("Forbidden")) return NextResponse.json({ error: message }, { status: 403 });
  if (message.startsWith("Illegal transition") || message.startsWith("Missing required fields")) {
    return NextResponse.json({ error: message }, { status: 409 });
  }
  console.error("[api] unhandled error:", err);
  return NextResponse.json({ error: message }, { status: 500 });
}
