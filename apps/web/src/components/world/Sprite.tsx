"use client";

import { useId } from "react";
import styles from "./world.module.css";

/** Original digital beings; decorative expressions never imply ecological measurements. */
export function Sprite({
  kind = "creek",
  mood = "asleep",
  className = "",
}: {
  kind?: string;
  mood?: string;
  className?: string;
}) {
  const id = useId().replace(/:/g, "");
  const forest = /forest|tree|wood|plant/.test(kind);
  const animal = /animal|elk|bear|wildlife|species|migration/.test(kind);
  const mountain = /mountain|ridge|alpine|snow/.test(kind);
  const color = forest
    ? "#c5e3a1"
    : animal
      ? "#edc79f"
      : mountain
        ? "#e0d9ed"
        : "#b5e4dc";
  return (
    <svg
      viewBox="0 0 160 180"
      aria-hidden="true"
      className={`${styles.sprite} ${className}`}
      data-mood={mood}
    >
      <defs>
        <radialGradient id={`${id}body`} cx="35%" cy="25%" r="85%">
          <stop stopColor="#fffef0" />
          <stop offset=".65" stopColor={color} />
          <stop offset="1" stopColor={forest ? "#6eab83" : "#70aba5"} />
        </radialGradient>
        <radialGradient id={`${id}glow`}>
          <stop stopColor={color} stopOpacity=".55" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="80" cy="158" rx="32" ry="7" fill="#143f39" opacity=".16" />
      <circle cx="80" cy="95" r="73" fill={`url(#${id}glow)`} />
      <g className={styles.spriteBody}>
        <path
          d="M41 90Q14 53 17 86Q19 111 46 114M119 90Q146 53 143 86Q141 111 114 114"
          fill="#e7f4d9"
          opacity=".75"
        />
        {animal && (
          <g fill={color} stroke="#bc9875" strokeWidth="2">
            <path d="M49 66Q23 38 35 34Q58 32 64 58" />
            <path d="M111 66Q137 38 125 34Q102 32 96 58" />
          </g>
        )}
        <path
          d="M78 46C109 42 126 72 121 103Q122 127 101 136L92 145Q85 147 79 139Q70 151 62 143L59 136Q35 128 38 103C31 72 47 48 78 46Z"
          fill={`url(#${id}body)`}
          stroke="#eff5d9"
          strokeOpacity=".75"
          strokeWidth="1.4"
        />
        <ellipse
          cx="79"
          cy="112"
          rx="23"
          ry="19"
          fill="#fffef2"
          opacity=".23"
        />
        {forest ? (
          <g fill="#739e56">
            <path d="M81 51Q41 50 39 27Q72 22 81 51" />
            <path d="M80 51Q81 20 112 20Q115 47 80 51" />
            <path d="M78 46Q74 17 87 12Q98 37 78 46" fill="#abd174" />
          </g>
        ) : mountain ? (
          <path
            d="M61 48L73 26L84 44L93 30L104 51"
            fill="#f9f8e9"
            stroke="#d6dfdc"
            strokeWidth="2"
          />
        ) : !animal ? (
          <g fill="#7dab76">
            <path d="M81 47Q58 42 61 22Q83 22 81 47" />
            <path d="M80 45Q90 24 110 31Q100 48 80 45" />
          </g>
        ) : null}
        {mood === "asleep" ? (
          <g stroke="#345851" strokeWidth="3" fill="none" strokeLinecap="round">
            <path d="M56 91Q62 96 68 91" />
            <path d="M91 91Q97 96 103 91" />
          </g>
        ) : (
          <g fill="#284d43">
            <ellipse cx="63" cy="92" rx="4" ry="6" />
            <ellipse cx="97" cy="92" rx="4" ry="6" />
            <circle cx="64" cy="90" r="1.3" fill="white" />
            <circle cx="98" cy="90" r="1.3" fill="white" />
          </g>
        )}
        <ellipse
          cx="50"
          cy="103"
          rx="7"
          ry="3.5"
          fill="#e5b2a5"
          opacity=".55"
        />
        <ellipse
          cx="109"
          cy="103"
          rx="7"
          ry="3.5"
          fill="#e5b2a5"
          opacity=".55"
        />
        <path
          d="M76 104Q80 108 84 104"
          fill="none"
          stroke="#527466"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M39 107Q25 103 31 116Q37 125 43 119M120 107Q134 103 129 116Q123 125 117 119"
          fill={color}
        />
        <path d="M77 118L80 113L84 118L80 125Z" fill="#d5aa58" opacity=".8" />
      </g>
      <g fill="#ffedb6">
        <circle cx="29" cy="48" r="2" />
        <circle cx="128" cy="132" r="2.5" />
        <path d="M126 48v8m-4-4h8" stroke="#ffedb6" strokeWidth="1.5" />
      </g>
    </svg>
  );
}
