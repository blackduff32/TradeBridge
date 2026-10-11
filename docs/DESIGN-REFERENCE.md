# Quantara → TradeBridge: distilled taste

Reference inspected in the browser: [Quantara template](https://webflow.com/templates/html/quantara-website-template) and [live preview](https://sign-quantara.webflow.io/), by Slidesignus Studio. This is a study of visual principles, with original TradeBridge code, copy, vector geometry and assets.

**The useful idea:** a quiet technical instrument. Black makes the structure recede; precise white typography carries the message; a small amount of blue gives the system a recognizable signal.

| Observed in Quantara | TradeBridge rule | Where it lives |
|---|---|---|
| Near-black expanses with dark panels | Use black for the document and charcoal for evidence surfaces; avoid a stack of competing bright cards. | Runtime palette in `web/styles.css` |
| Large, light sans-serif statements | Entry gets a short, spacious headline; operational screens get smaller task headings. | Welcome and page headings |
| Blue geometric/technical imagery | Use an original wireframe bridge to describe the gap between buyer and broker records. | `web/public/brand/bridge-field.svg` |
| Thin grids, small indices and registration marks | Use as quiet structural detail around the entry graphic and README banner. | Presentation assets |
| Monochrome rounded navigation/actions | Pale primary actions, quiet dark secondary controls; consistent keyboard focus. | Shared Button and navigation |
| Monospace technical labels | Apply to hashes, exact numbers, source IDs and small section labels. | IBM Plex Mono |
| Generous section rhythm | Give the introduction room; keep the evidence table dense enough to compare. | Entry/workspace register split |
| Animated text and scroll effects | Translate to one short decorative entrance. Keep important text visible and amounts stationary. | Reduced-motion-aware CSS |

## The recipe

1. Start with the task and one clear sentence.
2. Set the canvas to `#08090B`, panels to `#101216`, text to `#F1F4FA` and blue signal to `#82ABFF`.
3. Create hierarchy with type scale and spacing before adding containers.
4. Give numbers, sources and status one stable alignment.
5. Use amber for discrepancies and reserve blue for expression or proposed values.
6. Add one meaningful geometric motif, then stop decorating.
7. Verify actual loading, error, empty, conflict and mobile states in the same visual system.

## Brand application

Name: **TradeBridge**. Pitch: **Catch the difference before settlement.** Short line: **Evidence before execution.** The logo is two opposing record brackets joined by an arrow. Public presentation uses original SVGs and real screenshots; it does not borrow the template's artwork, text, Webflow code or placeholder customer logos.

Canonical tokens and component usage are maintained in [DESIGN.md](../DESIGN.md). Financial authority and state transitions remain owned by the PRD/API and [UX contract](../UX-CONTRACT.md).
