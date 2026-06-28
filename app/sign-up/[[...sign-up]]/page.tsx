import { SignUp } from "@clerk/nextjs";
import Link from "next/link";
import { isClerkConfigured, safeAuthReturnPath, signInRedirectPath } from "@/lib/server/auth";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const params = await searchParams;
  const returnPath = safeAuthReturnPath(params.redirect_url);
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        {isClerkConfigured() ? (
          <SignUp
            routing="path"
            path="/sign-up"
            signInUrl={signInRedirectPath(returnPath)}
            forceRedirectUrl={returnPath}
            fallbackRedirectUrl={returnPath}
          />
        ) : (
          <AuthNotConfigured />
        )}
      </section>
    </main>
  );
}

function AuthNotConfigured() {
  return (
    <div className="auth-placeholder">
      <p className="microcopy">SaaS auth</p>
      <h1>Clerk is not configured</h1>
      <p>
        Add `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to enable registration. Do not create a
        custom password system for this product.
      </p>
      <Link href="/">Back to landing</Link>
    </div>
  );
}
