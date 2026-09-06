# Naming decision — Kami

PRD §11 #13 left the name open. The owner chose **Kami** (神): in Shinto, the spirits that inhabit and animate rivers, mountains, trees, and places. It fits the product's stance exactly — a presence *of* a place that people tend and speak with, not a person, not an owner.

Rules that survive the rename (PRD §13 #10, ADR-E13):
- Every kami says it is "an AI voice **for** <place>", never "the voice of" and never "as".
- Disclosure copy: "I'm an AI voice for Boulder Creek, built on public sensor data — not the creek, not a legal person."
- We do not claim Shinto religious authority and we do not use shrine iconography. The word names the product; the entities are software.
- "Tamagotchi" stays a description; "Speaker for the Living" stays Zoöp's.

Where the planning docs say "Ecological Entities", "the platform", or "entity", read "Kami" / "a kami". Entity ids remain `entity/<slug>` for schema stability.
