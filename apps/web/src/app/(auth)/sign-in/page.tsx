import type { Metadata } from "next";
import { auth as copy } from "@/copy";
import { SignInForm } from "./SignInForm";

export const metadata: Metadata = { title: copy.title, robots: { index: false } };

export default function SignInPage() {
  return (
    <div style={{ maxWidth: "28rem", margin: "1.5rem auto" }}>
      <h1>{copy.title}</h1>
      <SignInForm />
    </div>
  );
}
