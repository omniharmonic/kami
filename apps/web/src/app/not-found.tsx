import Link from "next/link";
import { errors, nav } from "@/copy";

export default function NotFound() {
  return (
    <div style={{ paddingTop: "2rem" }}>
      <h1>{errors.notFound}</h1>
      <Link href="/" className="btn">{nav.home}</Link>
    </div>
  );
}
