# Design framework (persistent reference for this project)

Synthesised from two sources. Use it when designing, reviewing or improving any page here.

- **Impeccable** (impeccable.style, by Paul Bakaus): design vocabulary, "AI slop" catalog (61 detector rules + 6 design-review patterns), commands such as polish / typeset / layout / colorize / animate / clarify / harden / distill / critique / audit.
- **Make Interfaces Feel Better** (github.com/jakubkrehel/make-interfaces-feel-better): 19 detail-level principles and a review format.

Sources actually read: Impeccable home, /slop, /designing, /docs/polish, /docs/typeset, /docs/critique; MIFB SKILL.md, surfaces.md, animations.md. Not read in full: MIFB typography.md / icons.md / performance.md, other Impeccable command pages, the author's article. Treat those areas as lighter-confidence.

## 0. How to use it
1. Name the visitor's job first (Impeccable's four modes): **Persuade** (landing/decide), **Operate** (finish a task), **Read**, **Experience**. This site = **Operate** (bid in under a minute, on a phone, at a live event) with a **Persuade** welcome/cause screen.
2. Keep the existing identity. Polish refines; it does not redesign. Use the project's own styling system, never add a second one.
3. Findings are a reason to look closer, not an order. Reject a rule when the product has a reason (record the reason).
4. Blocking defects first (broken, unreadable, inaccessible), then hierarchy, then consistency, then polish.

## 1. Impeccable: principles worth keeping
**Hierarchy and clarity**
- One thing should win the eye per screen. Title and button must not fight. Primary action visible and labelled with its result ("Place bid of Rs X").
- Group related items closer, separate groups with more space. Equal gaps everywhere = no grouping (monotonous spacing).
- Heading sits closer to its own content than to the previous block.
- Do not repeat the same text in one container; no label above a heading that repeats it; do not use badges/eyebrows as decoration.

**Typography**
- Body about 16px minimum; line-height about 1.5; line length 65-75 characters; no justified text; no wide tracking on body; no all-caps paragraphs (short labels are fine).
- Clear steps between heading, body, label and meta (size, weight, space). Flat hierarchy is a defect.
- Do not crush letter-spacing on big display text; avoid oversized hero headlines that fill the first screen.
- Pick type for the product's character, not defaults. Keep established brand fonts.

**Colour and contrast**
- WCAG AA: 4.5:1 body, 3:1 large text. Check text on tinted/gradient surfaces, not just white.
- Avoid gradient text, glow halos, neon-on-dark, purple-gradient defaults. Cream/beige is fine when it belongs to the product, but choose the rest as carefully.

**Layout and space**
- Avoid cards in cards; flatten with spacing, type and dividers. Avoid identical icon-heading-text card grids when ideas differ in weight.
- Padding must not be cramped; text must not touch the viewport edge; scrollers need matching edge space; no clipped popovers or overflow.
- Avoid side-tab accent borders, hairline border plus wide shadow on one card, extreme radii, decorative grids.

**Motion**
- No pulsing status dots, blinking cursors, marquees, bounce/elastic easing, hover-zoom on every image, or animation that changes layout (animate transforms).
- Content must be visible by default if an entrance animation fails.

**Copy**
- Say what people can do. Cut generic claims ("supercharge", "world-class"), em-dash overuse, forced contrast ("Not X. Y."), repeated text.

**Quality / harden**
- Check loading, empty, error, long-content and failure states. No JS errors on load. No broken/placeholder images. Heading levels in order. Keyboard focus visible.

**Process**
- critique (review) then polish (refine) then audit (a11y/perf/responsive). Try the real task, on a narrow screen, with a keyboard. A clean report is evidence, not proof.

## 2. Make Interfaces Feel Better: the details (with the numbers)
1. **Concentric radius**: outer radius = inner radius + padding (when padding is 24px or less).
2. **Optical over geometric alignment**: icon-side padding = text-side padding minus 2px; shift play triangles about 2px; fix asymmetric icons in the SVG.
3. **Shadows for elevation, borders for structure**: layered transparent box-shadow (ring + lift + ambient) for cards/buttons; keep real borders for dividers, inputs, selected/focus.
4. **Interruptible animations**: CSS transitions for interactive state; keyframes only for one-shot sequences.
5. **Split and stagger enters** about 100ms (80ms per word) for infrequent entrances only (opacity + 12px translateY + 4px blur).
6. **Subtle exits**: small fixed translateY (about 12px), shorter than enter (about 150ms vs 300ms), ease-out.
7. **Contextual icon swaps**: scale 0.25 to 1, opacity 0 to 1, blur 4px to 0; no bounce (cross-fade with cubic-bezier(0.2,0,0,1) if no motion lib).
8. **Font smoothing**: -webkit-font-smoothing: antialiased on root.
9. **Tabular numbers** on any changing number (bids, timers, counts): font-variant-numeric: tabular-nums.
10. **Text wrapping**: text-wrap: balance on headings; text-wrap: pretty on body.
11. **Image outlines**: 1px, pure black at 10% (light) or pure white at 10% (dark), outline-offset -1px; never a tinted neutral.
12. **Scale on press**: scale(0.96) on :active, 150ms ease-out; never below 0.95; allow a "static" opt-out.
13. **Skip animation on first load** for default-state elements.
14. **Never `transition: all`**; list exact properties.
15. **will-change sparingly** (transform, opacity, filter only; only after seeing stutter).
16. **Hit area**: 44x44px for touch (40px minimum in dense desktop UI); extend with a pseudo-element; hit areas never overlap.
17. **Icon stroke matches text weight**: 1.5px beside 400, 2px beside 600; one icon set per surface.
18. **One SVG per icon**, currentColor, states via CSS; outline default, fill = active.
19. **Motion restraint**: no custom animation on high-frequency interactions; motion is never the only feedback; honour prefers-reduced-motion.

**Review technique**: replay motion at 10% speed and walk every state (hover, focus, active, loading, empty). Report as a table: Severity (HIGH/MEDIUM/LOW), Location (file:line), Before, After, Why; list what was verified and what was not; list "considered but rejected".

## 3. What separates about 8/10 from about 9.3-9.5/10
- An 8 has no obvious mistakes. A 9.4 has no *unexplained* choices: every radius, size, gap, colour and duration comes from a small scale, and the same role looks the same everywhere.
- 8: right content, decent spacing. 9.4: spacing communicates grouping, one focal point per screen, optical (not just mathematical) alignment, concentric corners, stable numbers, balanced wrapping.
- 8: states exist. 9.4: every state is designed (hover/focus/active/disabled/loading/empty/error/long text), motion is interruptible, short, purposeful and optional.
- 8: looks fine on the designer's phone. 9.4: holds on small widths, large text, slow networks, one-handed use, keyboard, reduced motion.
- 8: could be any product's template. 9.4: type, colour and copy are specific to the product and its job; no AI-slop tells.
- 9.4 is subtraction as much as addition: fewer competing elements, fewer words, fewer effects.

## 4. Audit checklist (quick)
Mode and job named - one focal point per screen - hierarchy steps clear - spacing groups things - body 16px/1.5/65-75ch - AA contrast incl. on tints - no slop tells (see section 1) - radii from one scale and concentric - elevation by shadow, structure by border - numbers tabular - headings balanced, body pretty - press feedback 0.96 - no transition:all - hit areas 44px - icons consistent stroke/colour - all states designed - motion interruptible, <=150ms for frequent actions, reduced-motion honoured - works at 360px width and 200% zoom - keyboard focus visible - copy specific, no repeats - no console errors, no broken images.

## 5. When NOT to apply
Do not add motion to frequent actions (bid entry, tab switches). Do not add shadows/outlines everywhere "because the rule says". Do not change a font or palette that is the brand. Do not stagger or animate on repeated visits. Do not trade clarity or speed on a live-event phone for decoration.

## 6. Project notes (auction)
- Users: parents/guests on phones (mostly iPhone), at a live event, bidding quickly; admins on a desk.
- Performance and legibility outrank flourish. Money values must be unambiguous and stable.
- Brand: SBS / Jashn, warm cream + gold, Nunito headings, IBM Plex Sans body, Playfair wordmark.
