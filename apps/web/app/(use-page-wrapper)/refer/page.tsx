import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Appointments | Mancebo.ai",
  description: "Manage your availability and appointment booking links with Mancebo.ai.",
};

// Mancebo does not offer the inherited vendor referral/commission program.
export default function ReferralsPage() {
  redirect("/event-types");
}
