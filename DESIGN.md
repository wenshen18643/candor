# Design

Candor's visual system. Read PRODUCT.md first for who this is for and why.

## Stance

Calm, exact, humane. Restrained product UI on pure white (light) or neutral near-black (dark), with
one accent: **sealing-wax rose**, used for primary actions, current selection and the brand mark.
Everything else is semantic colour that carries evidence meaning. The landing page may drench a hero
in rose; product surfaces never do.

## Color tokens (OKLCH, `apps/web/src/app/globals.css`)

Use the Tailwind names, never raw values: `bg`, `surface`, `surface-2`, `surface-3`, `line`,
`line-strong`, `ink` (primary text), `ink-2` (secondary), `ink-3` (meta, large or short text only),
`seal`, `seal-hover`, `seal-soft`, `seal-ink` (seal-coloured text on light), `on-seal`.

Evidence semantics (always paired with an icon and a word, never colour alone):

| Token | Meaning |
| --- | --- |
| `documented` (+ `-soft`) | supported by document(s); corroborated uses the same hue |
| `info` | single source, inference, neutral information |
| `allegation` | reporter allegation, unverifiable |
| `contradicted` | conflicts with other evidence; genuine errors |
| `unsupported` | not supported, greyed slate |
| `quarantine` | prompt-injection quarantine |

Dark mode is `[data-theme="dark"]` on `<html>` (system default, toggle persists in localStorage).
Use `dark:` only when a token cannot express the difference.

## Typography

Single family chosen for legibility under stress: **Atkinson Hyperlegible Next** (`font-sans`) and
**Atkinson Hyperlegible Mono** (`font-mono`) for hashes, keys, codenames, IDs and code. Product scale
in rem, ratio about 1.2: `text-2xs` 11, `text-xs` 12, `text-sm` 13, `text-base` 14 (UI default),
`text-md` 16, `text-lg` 19, `text-xl` 23, `text-2xl` 28, `text-3xl` 34. Landing hero may use fluid
`clamp()` up to 4.5rem with letter-spacing no tighter than -0.03em. Weights 400, 500, 600 (700 only
for the landing hero). Prose max 68ch. `tabular` utility for numbers in tables and meters.

## Shape, depth, motion

Radii: `rounded-xs` 3, `sm` 5, `md` 7 (controls), `lg` 10 (panels), `xl` 14 (largest). No radius
above 14px except pills. Depth comes from `surface` layers and 1px `line` borders; `shadow-pop` only
for floating layers (menus, sheets, tooltips), never combined with a border on cards. Motion 150-250
ms, `--ease-out-quart` / `--ease-out-expo`, state changes only; reduced motion respected globally.
No gradient text, no glassmorphism, no side-stripe borders, no identical icon-card grids, no
eyebrow kicker above every section, no numbered section markers unless the content is a real
sequence.

## Components (`apps/web/src/components`)

- `ui/button` variants `primary | secondary | ghost | quiet | danger | link`, sizes `sm | md | lg | icon`, `loading` prop.
- `ui/badge` tones `neutral | seal | documented | allegation | unsupported | contradicted | info | quarantine | outline`.
- `ui/hash` truncated mono value with copy.
- `ui/tabs`, `ui/tooltip` (wrap app in `TooltipProvider`), `ui/sheet` (right-side drawer for detail; prefer inline over modal), `ui/field` (`Input`, `Textarea`, `Field`, `Kbd`, `Skeleton`), `ui/theme-toggle`.
- `evidence/badges`: `EvidenceClassBadge`, `VerdictBadge`, `QuarantineBadge`, `ConfidenceMeter` (10 segments + score).
- `brand/logo`: `SealMark`, `Logo`.
- `shell/site-header` for public pages.

Every interactive element has hover, focus-visible (2px seal outline), active, disabled and loading
states. Empty states teach what will appear and how to get there.

## Layout

Public pages: max width 1200px, 20px gutters on mobile, 32px on desktop. Console: left sidebar
(240px) + content; detail panels open as a right sheet. Tables are real `<table>` elements with
sticky headers. Charts use SVG with `role="img"`, an `aria-label`, and an accessible text
alternative (table or list) nearby.

## Copy

Plain, specific, calm. Reporter-facing text at an eighth-grade reading level and second person
("Your name never leaves this device."). Reviewer-facing text precise and neutral; never verdicts
("documented", "alleged", "not supported"), never "guilty", "fraud", "proven".
