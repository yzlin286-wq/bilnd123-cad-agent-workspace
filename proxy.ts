import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const isSaaSProtectedRoute = createRouteMatcher(["/app(.*)", "/admin(.*)"]);

const clerkProxy = clerkMiddleware(async (auth, request) => {
  const basic = stagingBasicAuthState(request);
  if (basic.response) return basic.response;
  if (isClerkConfiguredForProxy() && isSaaSProtectedRoute(request)) {
    await auth.protect();
  }
  return NextResponse.next();
});

const fallbackProxy = (request: NextRequest) => {
  const basic = stagingBasicAuthState(request);
  if (basic.response) return basic.response;
  if (isSaaSProtectedRoute(request) && !basic.authorized && process.env.SAAS_DEV_AUTH_BYPASS !== "1") {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next();
};

const handler = isClerkConfiguredForProxy() ? clerkProxy : fallbackProxy;

export default handler;
export const proxy = handler;

function stagingBasicAuthState(request: NextRequest) {
  const user = process.env.STAGING_BASIC_AUTH_USER;
  const password = process.env.STAGING_BASIC_AUTH_PASSWORD;
  if (!user || !password) {
    return { authorized: false, response: undefined };
  }

  const header = request.headers.get("authorization");
  if (isAuthorized(header, user, password)) {
    return { authorized: true, response: undefined };
  }

  return {
    authorized: false,
    response: new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="CAD Agent Staging", charset="UTF-8"',
      },
    }),
  };
}

function isClerkConfiguredForProxy() {
  return Boolean(process.env.CLERK_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
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
