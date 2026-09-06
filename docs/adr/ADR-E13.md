# ADR-E13 — Disclosure is a rendering invariant, not a prompt instruction

**Status:** accepted for build (2026-09-06)
**Context.** EU AI Act Art. 50 (since 2026-08-02) and SB 243 (since 2026-01-01) per B2 §9. A model can forget an instruction; a layout cannot.
**Decision.** The `EntityShell` layout renders the disclosure label under the avatar and above the chat on every entity route; the chat component injects the SB 243 reminder as a **system-rendered** message every N turns (default 12, *verify* the statutory cadence) counted by the web app, not by the model; every reply renders a "what I looked at" footer built from the turn's tool-call log returned by the gate. The SOUL also says it, as belt and braces.
**Consequences.** (+) 100 % disclosure coverage is a snapshot test. (−) Third-party clients of the platform MCP do not get the rendering; the platform MCP's chat tool therefore returns the label in its output.
**Alternatives rejected.** Prompt-only disclosure; a one-time banner.

## Build notes

_None yet._
