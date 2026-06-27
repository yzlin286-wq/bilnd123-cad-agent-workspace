"use client";

import Link from "next/link";
import { UserButton, useUser } from "@clerk/nextjs";

export function UserMenu() {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return <span className="user-menu-fallback">Internal auth</span>;
  }
  return <ClerkUserMenu />;
}

function ClerkUserMenu() {
  const { isSignedIn, isLoaded } = useUser();
  if (!isLoaded) return <span className="user-menu-fallback">Loading</span>;
  if (!isSignedIn) {
    return (
      <div className="user-menu">
        <Link href="/sign-in">Sign in</Link>
      </div>
    );
  }
  return (
    <div className="user-menu">
      <UserButton />
    </div>
  );
}
