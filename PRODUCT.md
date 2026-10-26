# Product

## Register

product

## Users

Two audiences on opposite sides of one disclosure.

- **Reporters**: employees, contractors or patients who hold evidence of wrongdoing and fear being
  identified. They arrive anxious, often on a personal device late at night, unsure what is safe
  to share. Their job: hand over evidence without handing over themselves, then answer follow-up
  questions without ever revealing who they are.
- **Reviewers**: ethics, compliance and investigations staff at an organisation (and hackathon
  judges evaluating the system). They work at a desk with long, focused sessions. Their job: turn
  scattered evidence into an account they can trust, see exactly what is documented versus
  alleged, and decide what to do next without the tool deciding for them.
- **Auditors**: anyone who needs to verify after the fact that the platform behaved as promised
  (access logged, nothing tampered with).

## Product Purpose

Candor lets people disclose wrongdoing while exposing as little of themselves as possible, and gives
reviewers a grounded, cited, uncertainty-aware account of what happened. Identity is proven with a
zero-knowledge passport proof and unlinkable blind tokens; evidence is scrubbed on the reporter's
device and encrypted so the server only ever stores ciphertext; a multi-stage Meta Muse pipeline
extracts a timeline, checks every finding against its source, flags contradictions and injected
instructions, and asks follow-up questions. Success: a reporter submits with confidence in under
ten minutes, and a reviewer can trace every sentence in the brief back to a verbatim source.

## Brand Personality

Discreet, exact, humane. The voice of a calm specialist who explains precisely what happens to your
data and never oversells. Plain words for reporters, technical depth on demand for reviewers and
judges. Emotional goals: safety and composure for reporters, confidence and rigour for reviewers,
"this is real engineering" for judges.

## Anti-references

- Generic AI SaaS: gradient hero, glowing purple orbs, "AI-powered" badges, identical feature cards.
- Crypto/web3 aesthetics: neon on black, coins, chain motifs, hype copy. Payments and proofs are
  infrastructure here, not the brand.
- Corporate hotline portals (NAVEX-style): stock photos of handshakes, beige forms, legalese walls.
- Surveillance/hacker clichés: green terminal text, hooded figures, padlock clip-art, "military-grade".
- Cream/paper editorial pastiche.

## Design Principles

1. **Show the mechanism.** Every privacy or integrity claim is backed by something the user can see:
   the metadata that was removed, the bytes that were sealed, the proof that verified.
2. **Evidence before narrative.** Findings never appear without their source; documented, alleged and
   unsupported are visually unmistakable.
3. **Calm under pressure.** Reporters are frightened. One decision per screen, generous space,
   reversible steps, no alarming red unless something is genuinely wrong.
4. **Uncertainty is information.** Confidence, date ranges and contradictions are first-class visual
   elements, not footnotes.
5. **People decide.** The interface frames questions and evidence; it never renders verdicts.

## Accessibility & Inclusion

WCAG 2.2 AA. Full keyboard operation, visible focus, screen-reader labels for every status badge and
chart (with text equivalents for timeline and graph). Status never encoded by colour alone (icons
and words accompany colour). Respect `prefers-reduced-motion` everywhere. Plain-language copy for
reporters at roughly an eighth-grade reading level. Works on a phone for the reporter flow.
