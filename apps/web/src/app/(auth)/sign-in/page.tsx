import type { Metadata } from "next";
import { auth as copy } from "@/copy";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: copy.title, robots: { index: false } };

export default async function SignInPage() {
  if (await getSession()) redirect("/me");
  return (
    <div style={{ maxWidth: "28rem", margin: "1.5rem auto" }}>
      <h1>{copy.title}</h1>
      <SignInForm />
    </div>
  );
}
