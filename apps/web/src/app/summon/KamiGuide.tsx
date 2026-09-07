import styles from "./summon.module.css";
import { experience } from "./experience-copy";

export function KamiGuide() {
  return <aside className={styles.guide} aria-label={experience.mascot}>
    <svg className={styles.kami} viewBox="0 0 320 300" role="img" aria-label="Kami, a small pearlescent sprite with leaf ears, resting above a pool">
      <ellipse cx="160" cy="266" rx="105" ry="15" fill="#77a8a1" opacity=".18" />
      <ellipse cx="160" cy="266" rx="67" ry="8" fill="none" stroke="#9acfc0" strokeWidth="2" />
      <g className={styles.sprite}>
        <path d="M133 98C95 99 68 64 81 30c31 8 57 32 52 68" fill="#8cba8a" />
        <path d="M181 94c-7-40 18-69 49-72 1 39-16 69-49 72" fill="#b5d19a" />
        <path d="M130 93 91 43m91 47 34-54" stroke="#e4ecd4" strokeWidth="3" strokeLinecap="round" />
        <path d="M100 155c-23 1-44 24-40 35 3 9 23 1 36-5m124-29c20 0 44 24 40 35-3 9-23 1-36-5" fill="#dae9d5" />
        <path d="M158 79c-47 0-72 45-69 90 2 43 25 73 52 68l19-11 19 11c28 5 52-25 54-68 3-45-26-90-75-90Z" fill="#e8efd9" />
        <path d="M100 179c9 26 26 41 60 40 33 1 53-14 63-40-4 35-22 60-44 58l-19-11-19 11c-20 3-35-19-41-58" fill="#bed5bd" />
        <ellipse cx="133" cy="152" rx="6" ry="9" fill="#2e5650" /><ellipse cx="187" cy="152" rx="6" ry="9" fill="#2e5650" />
        <circle cx="135" cy="149" r="2" fill="white" /><circle cx="189" cy="149" r="2" fill="white" />
        <ellipse cx="118" cy="170" rx="10" ry="5" fill="#daa99e" opacity=".6" /><ellipse cx="202" cy="170" rx="10" ry="5" fill="#daa99e" opacity=".6" />
        <path d="M152 173q8 8 16 0" fill="none" stroke="#507268" strokeWidth="3" strokeLinecap="round" />
        <path d="M150 105q10-21 20 0-10 19-20 0" fill="#89b3a0" /><circle cx="159" cy="104" r="3" fill="#f3f0c7" />
      </g>
      <path d="m54 112 3-8 3 8 8 3-8 3-3 8-3-8-8-3Zm202 116 2-6 2 6 6 2-6 2-2 6-2-6-6-2Z" fill="#dccd88" />
    </svg>
    <span className={styles.guideName}>{experience.mascot}</span>
    <h2>{experience.greeting}</h2>
    <p>{experience.greetingDetail}</p>
  </aside>;
}
