import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  const user = process.env.STAGING_BASIC_AUTH_USER;
  const password = process.env.STAGING_BASIC_AUTH_PASSWORD;
  if (!user || !password) {
    return NextResponse.next();
  }

  const header = request.headers.get("authorization");
  if (isAuthorized(header, user, password)) {
    return NextResponse.next();
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="CAD Agent Staging", charset="UTF-8"',
    },
  });
}

function isAuthorized(header: string | null, user: string, password: string) {
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = atob(header.slice("Basic ".length));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return decoded.slice(0, separator) === user && decoded.slice(separator + 1) === password;
  } catch {
    return false;
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
