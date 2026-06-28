import { auth as clerkAuth, clerkClient } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { StoredProject } from "@/lib/project/types";

export type AuthSource = "clerk" | "staging_basic_auth" | "dev_bypass";

export type AuthContext = {
  isAuthenticated: boolean;
  source?: AuthSource;
  userId?: string;
  organizationId?: string;
  organizationRole?: string;
  email?: string;
  isAdmin: boolean;
};

const INTERNAL_USER_ID = "internal-staging-user";
const INTERNAL_ORG_ID = "internal-staging";

export function isClerkConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

export async function getRequestAuthContext(request: Request): Promise<AuthContext> {
  if (isClerkConfigured()) {
    return clerkAuthContext();
  }
  return fallbackAuthContext(request.headers.get("authorization"));
}

export async function getPageAuthContext(): Promise<AuthContext> {
  if (isClerkConfigured()) {
    return clerkAuthContext();
  }
  const headerList = await headers();
  return fallbackAuthContext(headerList.get("authorization"));
}

export async function requireRequestAuth(request: Request) {
  const auth = await getRequestAuthContext(request);
  if (!auth.isAuthenticated || !auth.userId) {
    return { auth, response: unauthorizedResponse() };
  }
  return { auth, response: undefined };
}

export function unauthorizedResponse() {
  return Response.json({ error: "AUTH_REQUIRED", userMessage: "Sign in to access this CAD workspace." }, { status: 401 });
}

export function forbiddenResponse() {
  return Response.json({ error: "FORBIDDEN", userMessage: "You do not have access to this project." }, { status: 403 });
}

export function canAccessProject(auth: AuthContext, project: Pick<StoredProject, "ownerUserId" | "organizationId">) {
  if (!auth.isAuthenticated) return false;
  if (auth.isAdmin) return true;
  if (project.ownerUserId && auth.userId && project.ownerUserId === auth.userId) return true;
  if (project.organizationId && auth.organizationId && project.organizationId === auth.organizationId) return true;
  return false;
}

export function isAdminUser(auth: AuthContext) {
  if (!auth.isAuthenticated) return false;
  if (auth.isAdmin) return true;
  if (auth.organizationRole && ["admin", "org:admin", "owner"].includes(auth.organizationRole)) return true;
  return envList("SAAS_ADMIN_USER_IDS").includes(auth.userId || "") || envList("SAAS_ADMIN_EMAILS").includes(auth.email || "");
}

export function adminRouteAccess(auth: AuthContext): "allow" | "sign_in" | "forbidden" {
  if (!auth.isAuthenticated) return "sign_in";
  return isAdminUser(auth) ? "allow" : "forbidden";
}

export function appRouteAccess(auth: AuthContext): "allow" | "sign_in" {
  return auth.isAuthenticated ? "allow" : "sign_in";
}

export function redirectToSignIn(pathname = "/app") {
  const url = new URL("/sign-in", "http://localhost");
  url.searchParams.set("redirect_url", pathname);
  return NextResponse.redirect(url);
}

async function clerkAuthContext(): Promise<AuthContext> {
  try {
    const session = await clerkAuth();
    const claims = (session.sessionClaims || {}) as Record<string, unknown>;
    const clerkProfile = session.userId ? await loadClerkProfile(session.userId) : undefined;
    const email = stringClaim(claims.email) || stringClaim(claims.primary_email_address) || clerkProfile?.email;
    const baseContext: AuthContext = {
      isAuthenticated: Boolean(session.userId),
      source: "clerk",
      userId: session.userId || undefined,
      organizationId: session.orgId || undefined,
      organizationRole: session.orgRole || undefined,
      email,
      isAdmin: false,
    };
    return { ...baseContext, isAdmin: isAdminUser(baseContext) || clerkProfile?.role === "admin" };
  } catch {
    return { isAuthenticated: false, isAdmin: false };
  }
}

async function loadClerkProfile(userId: string) {
  try {
    const client = await clerkClient();
    const user = await client.users.getUser(userId);
    return {
      email: user.primaryEmailAddress?.emailAddress,
      role: metadataRole(user.publicMetadata) || metadataRole(user.privateMetadata),
    };
  } catch {
    return undefined;
  }
}

function metadataRole(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return undefined;
  const role = (metadata as Record<string, unknown>).role;
  return typeof role === "string" ? role : undefined;
}

function fallbackAuthContext(header: string | null): AuthContext {
  if (isBasicAuthHeaderAuthorized(header)) {
    return {
      isAuthenticated: true,
      source: "staging_basic_auth",
      userId: process.env.SAAS_DEV_USER_ID || INTERNAL_USER_ID,
      organizationId: process.env.SAAS_DEV_ORG_ID || INTERNAL_ORG_ID,
      organizationRole: "admin",
      isAdmin: true,
    };
  }
  if (process.env.SAAS_DEV_AUTH_BYPASS === "1") {
    const context: AuthContext = {
      isAuthenticated: true,
      source: "dev_bypass",
      userId: process.env.SAAS_DEV_USER_ID || "local-dev-user",
      organizationId: process.env.SAAS_DEV_ORG_ID || "local-dev-org",
      organizationRole: process.env.SAAS_DEV_ADMIN === "1" ? "admin" : "member",
      isAdmin: process.env.SAAS_DEV_ADMIN === "1",
    };
    return { ...context, isAdmin: isAdminUser(context) };
  }
  return { isAuthenticated: false, isAdmin: false };
}

export function isBasicAuthHeaderAuthorized(header: string | null) {
  const user = process.env.STAGING_BASIC_AUTH_USER;
  const password = process.env.STAGING_BASIC_AUTH_PASSWORD;
  if (!user || !password) return false;
  if (!header?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return decoded.slice(0, separator) === user && decoded.slice(separator + 1) === password;
  } catch {
    return false;
  }
}

function stringClaim(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function envList(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
