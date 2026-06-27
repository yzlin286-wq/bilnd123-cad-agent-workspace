import { SignIn } from "@clerk/nextjs";
import Link from "next/link";
import { isClerkConfigured } from "@/lib/server/auth";

export default function SignInPage() {
  return (
    <main className="auth-shell">
      <section className="auth-panel">
        {isClerkConfigured() ? (
          <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" />
        ) : (
          <AuthNotConfigured mode="sign in" />
        )}
      </section>
    </main>
  );
}

function AuthNotConfigured({ mode }: { mode: string }) {
  return (
    <div className="auth-placeholder">
      <p className="microcopy">SaaS auth</p>
      <h1>Clerk is not configured</h1>
      <p>
        Add `CLERK_SECRET_KEY` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to enable {mode}. Local operators can use
        Basic Auth protected staging or `SAAS_DEV_AUTH_BYPASS=1` for development only.
      </p>
      <Link href="/">Back to landing</Link>
    </div>
  );
}
