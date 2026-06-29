import { auth as clerkAuth, clerkClient } from "@clerk/nextjs/server";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import type { StoredProject } from "@/lib/project/types";

export type AuthSource = "clerk" | "local_password" | "staging_basic_auth" | "dev_bypass";

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
export const LOCAL_SESSION_COOKIE_NAME = "cad_agent_session";
export const LOCAL_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export function isClerkConfigured() {
  return Boolean(process.env.CLERK_SECRET_KEY?.trim() && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.trim());
}

export async function getRequestAuthContext(request: Request): Promise<AuthContext> {
  const localAuth = localPasswordAuthContext(request.headers.get("cookie"));
  if (localAuth.isAuthenticated) return localAuth;
  if (isClerkConfigured()) {
    return clerkAuthContext();
  }
  return fallbackAuthContext(request.headers.get("authorization"));
}

export async function getPageAuthContext(): Promise<AuthContext> {
  const headerList = await headers();
  const localAuth = localPasswordAuthContext(headerList.get("cookie"));
  if (localAuth.isAuthenticated) return localAuth;
  if (isClerkConfigured()) {
    return clerkAuthContext();
  }
  return fallbackAuthContext(headerList.get("authorization"));
}

export async function requireRequestAuth(request: Request) {
  const auth = await getRequestAuthContext(request);
  if (!auth.isAuthenticated || !auth.userId) {
    return { auth, response: unauthorizedResponse() };
  }
  return { auth, response: undefined };
}

export async function requireSaasRequestAuth(request: Request) {
  const auth = await getRequestAuthContext(request);
  if (!auth.isAuthenticated || !auth.userId || !isSaasIdentity(auth)) {
    return { auth, response: unauthorizedResponse() };
  }
  return { auth, response: undefined };
}

export function isSaasIdentity(auth: AuthContext) {
  return auth.source === "clerk" || auth.source === "local_password" || auth.source === "dev_bypass";
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
  if (!auth.isAuthenticated || !isSaasIdentity(auth)) return "sign_in";
  return isAdminUser(auth) ? "allow" : "forbidden";
}

export function appRouteAccess(auth: AuthContext): "allow" | "sign_in" {
  return auth.isAuthenticated && isSaasIdentity(auth) ? "allow" : "sign_in";
}

export function signInRedirectPath(returnPath = "/app") {
  const params = new URLSearchParams();
  params.set("redirect_url", safeAuthReturnPath(returnPath));
  return `/sign-in?${params.toString()}`;
}

export function signUpRedirectPath(returnPath = "/app") {
  const params = new URLSearchParams();
  params.set("redirect_url", safeAuthReturnPath(returnPath));
  return `/sign-up?${params.toString()}`;
}

export function redirectToSignIn(pathname = "/app") {
  const url = new URL(signInRedirectPath(pathname), "http://localhost");
  return NextResponse.redirect(url);
}

export function safeAuthReturnPath(value: string | null | undefined) {
  const fallback = "/app";
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  try {
    const url = new URL(value, "http://internal.local");
    if (url.origin !== "http://internal.local") return fallback;
    if (!isAllowedAuthReturnPath(url.pathname)) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

function isAllowedAuthReturnPath(pathname: string) {
  return pathname === "/app" || pathname.startsWith("/app/") || pathname === "/admin" || pathname.startsWith("/admin/");
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

export function isLocalPasswordAuthConfigured(env: Record<string, string | undefined> = process.env) {
  return Boolean(localPasswordConfig(env));
}

export function verifyLocalPassword(username: string, password: string, env: Record<string, string | undefined> = process.env) {
  const config = localPasswordConfig(env);
  if (!config) return false;
  return timingSafeEqualString(username.trim(), config.username) && timingSafeEqualString(password, config.password);
}

export function createLocalSessionToken(username: string, now = Date.now(), env: Record<string, string | undefined> = process.env) {
  const config = localPasswordConfig(env);
  if (!config || username.trim() !== config.username) return undefined;
  const issuedAt = Math.floor(now / 1000);
  const payload = {
    v: 1,
    username: config.username,
    email: config.email,
    iat: issuedAt,
    exp: issuedAt + LOCAL_SESSION_TTL_SECONDS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${encodedPayload}.${signLocalSessionPayload(encodedPayload, config.sessionSecret)}`;
}

export function verifyLocalSessionToken(token: string | undefined, now = Date.now(), env: Record<string, string | undefined> = process.env) {
  const config = localPasswordConfig(env);
  if (!config || !token) return undefined;
  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra) return undefined;
  const expectedSignature = signLocalSessionPayload(encodedPayload, config.sessionSecret);
  if (!timingSafeEqualString(signature, expectedSignature)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as {
      v?: unknown;
      username?: unknown;
      email?: unknown;
      iat?: unknown;
      exp?: unknown;
    };
    if (payload.v !== 1 || typeof payload.username !== "string" || payload.username !== config.username) return undefined;
    if (typeof payload.exp !== "number" || payload.exp <= Math.floor(now / 1000)) return undefined;
    return {
      username: payload.username,
      email: typeof payload.email === "string" && payload.email ? payload.email : config.email,
      expiresAt: payload.exp,
    };
  } catch {
    return undefined;
  }
}

export function isLocalSessionCookieSecure(env: Record<string, string | undefined> = process.env) {
  return env.STAGING_HTTPS_ENABLED === "1" || env.APP_AUTH_COOKIE_SECURE === "1";
}

export function publicRequestUrl(request: Request, path: string) {
  const safePath = path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : "/app";
  const configuredBase = normalizePublicBaseUrl(process.env.STAGING_PUBLIC_BASE_URL || process.env.APP_PUBLIC_BASE_URL);
  const headerBase = requestOriginFromHeaders(request);
  return new URL(safePath, configuredBase || headerBase || request.url);
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

function localPasswordAuthContext(cookieHeader: string | null): AuthContext {
  const session = verifyLocalSessionToken(readCookie(cookieHeader, LOCAL_SESSION_COOKIE_NAME));
  if (!session) return { isAuthenticated: false, isAdmin: false };
  const context: AuthContext = {
    isAuthenticated: true,
    source: "local_password",
    userId: `local:${session.username}`,
    email: session.email || session.username,
    organizationId: process.env.APP_AUTH_ORG_ID || INTERNAL_ORG_ID,
    organizationRole: "admin",
    isAdmin: true,
  };
  return context;
}

function localPasswordConfig(env: Record<string, string | undefined>) {
  const username = env.APP_AUTH_USER?.trim();
  const password = env.APP_AUTH_PASSWORD;
  const sessionSecret = env.APP_AUTH_SESSION_SECRET;
  if (!username || !password || !sessionSecret || sessionSecret.length < 32) return undefined;
  return {
    username,
    password,
    sessionSecret,
    email: env.APP_AUTH_EMAIL?.trim() || username,
  };
}

function signLocalSessionPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret).update(encodedPayload).digest("base64url");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function timingSafeEqualString(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function readCookie(cookieHeader: string | null, name: string) {
  if (!cookieHeader) return undefined;
  for (const chunk of cookieHeader.split(";")) {
    const [rawName, ...valueParts] = chunk.trim().split("=");
    if (rawName === name) return valueParts.join("=");
  }
  return undefined;
}

function normalizePublicBaseUrl(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

function requestOriginFromHeaders(request: Request) {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost || firstHeaderValue(request.headers.get("host"));
  if (!host) return undefined;
  const proto =
    firstHeaderValue(request.headers.get("x-forwarded-proto")) ||
    (process.env.STAGING_HTTPS_ENABLED === "1" ? "https" : "http");
  return `${proto}://${host}`;
}

function firstHeaderValue(value: string | null) {
  return value
    ?.split(",")[0]
    ?.trim()
    .replace(/\/+$/, "");
}

function envList(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
