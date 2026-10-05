---
version: alpha
name: TradeBridge
description: Precise trade evidence in a quiet technical workspace.
colors:
  primary: '#F1F4FA'
  on-primary: '#080A0E'
  primary-hover: '#CFDDFA'
  background: '#08090B'
  surface: '#101216'
  surface-alt: '#191C22'
  foreground: '#F1F4FA'
  muted: '#A1A8B5'
  border: '#2B3039'
  sidebar: '#0C0E12'
  accent: '#82ABFF'
  accent-soft: '#111D32'
  warning: '#EDBA79'
  warning-soft: '#241C14'
  warning-border: '#57432B'
  danger: '#FF9B9F'
  danger-soft: '#2B171C'
  danger-border: '#6A3A45'
  success: '#8BD7BD'
  success-soft: '#13251F'
  input-border: '#606A7A'
  scrollbar: '#606A7A'
  selection: '#264980'
typography:
  sans:
    fontFamily: 'Manrope, sans-serif'
  mono:
    fontFamily: 'IBM Plex Mono, monospace'
rounded:
  DEFAULT: '0.625rem'
  sm: '0.375rem'
spacing:
  page: '2rem'
  section: '1.5rem'
components:
  button: {}
  field: {}
  table: {}
  notice: {}
---

# TradeBridge design system

## Overview

An evidence desk with the visual precision of a technical instrument: near-black canvas, quiet monochrome surfaces, blue signals and legible exact amounts. Buyer and broker operations reviewers need to find a disagreement, preserve its provenance and understand the next authorized action. English, global audience, UTC dates; no Japan-specific product scope is established.

The user selected [Quantara by Slidesignus Studio](https://webflow.com/templates/html/quantara-website-template) as the taste reference. The original implementation translates its black/white/blue contrast, fine grids, light display typography and measured spacing. The entry screen is a brand surface; the authenticated workspace is a product surface. The durable distillation is in [docs/DESIGN-REFERENCE.md](docs/DESIGN-REFERENCE.md).

The signature is a blue wireframe bridge between two unresolved records. It appears in introductory/presentation assets only. Actual trade review keeps side-by-side evidence, exact amounts and semantic mismatch indicators. DENSITY=2, DATA_COMPLEXITY=3, CONSEQUENCE=3. No invented operational metrics or simulated verification success.

Runtime CSS variables in `web/styles.css` remain canonical (Model B). `colors.*` mirrors `--color-*`; typography maps to `--font-sans`/`--font-mono`; rounded.DEFAULT maps to `--radius`; spacing maps to `--space-page`/`--space-section`. Shared primitives consume those variables directly. There is one theme and no second adapter. Presentation SVGs use the same accepted palette. `web/public/brand/mark.svg` is the canonical brand mark.

## Colors

Near-black background and slightly raised charcoal surfaces form the base. Primary actions are pale with dark labels. Electric blue is the expressive accent for the mark, source geometry, proposed amounts and selected navigation. It does not imply approval. Amber means unresolved differences, mint means a matched/completed state, and rose means an error. Text and icons also express every state.

Muted text remains visibly legible against black. Fields use a stronger input border than panel dividers. No white panels remain in the dark theme. Forced colors defer to platform defaults; no automatic theme switching is introduced.

## Typography

Locally bundled Manrope for prose and interface labels; IBM Plex Mono for identifiers, indices, hashes and exact values. Introductory heading 46–68px with 400 weight and tight tracking; product page heading 38px/1.2 at 450. Panel headings 17–18px, reading copy 15–16px/1.6, controls 14–15px, secondary text 13px, supporting metadata 12px. Nothing renders below 12px. Mobile form inputs retain 16px. Do not use display scale inside data rows.

Financial values use tabular numerals and BigInt formatting. Never abbreviate settlement amounts. Full hashes wrap. All dates include UTC through the shared formatter.

## Layout

Entry: centered maximum 1360px with 48px gutters; two-column copy/illustration, then a three-step explanation and development sign-in. Mobile collapses into one natural document flow with 20px gutters.

Workspace: 216px navigation, 64px top bar and 32px gutters. Evidence occupies the flexible left column; the proposal uses 320–360px. Below 1150px the proposal follows evidence. Below 760px navigation becomes a labeled two-by-two grid with 16px content gutters. The document owns vertical scrolling. Only the bounded evidence table owns horizontal scrolling; no fixed-height ancestor clips a form.

## Elevation & Depth

Thin charcoal borders and small changes in surface tone establish hierarchy. A subtle top-light gradient is reserved for the trade summary. The entry illustration uses original vector linework and a restrained blue glow. Data surfaces stay opaque. No decorative charts or fake analytics.

## Shapes

10px panels, 6–7px controls, square table rows. Rounded capsule treatment is reserved for the entry CTA and workspace-access link. The opposing brackets and linking arrow in the TradeBridge mark express two records becoming connected. Lucide icons remain 16–22px with restrained strokes.

## Components

`web/components/ui.tsx` remains the owner of Button, Field, Notice, Empty and Hash. Brand owns the shared wordmark lockup; Welcome owns the introductory route and sign-in presentation. Existing handlers, session boundaries and authorization gates remain unchanged. No financial operation becomes optimistic.

Global scrollbars inherit track/thumb/hover/active tokens; forced colors remain platform-operable. Forms preserve input across validation, conflict and network errors. Busy/disabled/focus states remain perceivable. No browser-native alert/confirm/prompt is introduced.

Introductory motion is a short transform on decorative geometry only. Text and controls are visible immediately at full contrast. Reduced motion disables it. Product operations use brief color feedback and the established activity indicator.

## Do's and Don'ts

- Keep original evidence next to proposed terms.
- Use generous space at entry and practical density at the review desk.
- Express verification, consent, commitment and settlement as separate states.
- Keep primary copy short, concrete and accurate about integration readiness.
- Do not animate amounts, scramble labels or loop decorative motion during review.
- Do not use blue as evidence of authorization, hide critical text on hover, or imply a local change is a chain transaction.
