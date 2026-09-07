import type { ReactNode } from "react";
import Link from "next/link";
import styles from "./summon.module.css";
import { experience } from "./experience-copy";

export default function SummonLayout({ children }: { children: ReactNode }) {
  return <div className={styles.world}>
    <Link href="/" className={styles.back}>{experience.back}</Link>
    <div className={styles.sheet}>{children}</div>
  </div>;
}
