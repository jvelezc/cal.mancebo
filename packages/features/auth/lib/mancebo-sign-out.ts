import { signOut as nativeSignOut } from "next-auth/react";

export async function signOut(options?: Parameters<typeof nativeSignOut>[0]): Promise<void> {
  if (process.env.NEXT_PUBLIC_MANCEBO_AUTH_ENABLED === "true") {
    window.dispatchEvent(new Event("mancebo:appointments-sign-out"));
    return;
  }
  await nativeSignOut(options);
}
