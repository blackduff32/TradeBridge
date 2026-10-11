# Live integrations: Sui testnet settlement, World ID and World ID for Agents

Given to Claude Code (Claude Opus 5.5) in the Claude desktop app on 26 September 2026, starting at 03:02 JST. The work is on branch `claude/a-5673dc`. The prompts are verbatim.

## Prompts

> font size is a bit small

> it honestly feels like a web2 project. https://ethglobal.com/events/tokyo2026/info we are literally competing in this https://ethglobal.com/events/tokyo2026/prizes. optimise for wins

> Try again

> can u control my browser and do most for me

## Decisions confirmed by the user

The agent asked before each outward-facing step, and the user answered yes to:

- publishing the TradeBridge package and demo coins to Sui testnet;
- finishing the World Developer Portal setup: a signer key generated locally into `.env`, only its public address registered ("Use Existing Key"), and the `tradebridge-approval` action;
- registering a TradeBridge client in the World ID for Agents sandbox portal.

## Notes

- The agent drove the user's Chrome for the Sui faucet and the World Developer Portal. The user kept CAPTCHAs, sign-ins and secret keys.
- Claude Sonnet subagents built the World ID approval path and the World ID for Agents gating from briefs written by the main session, which reviewed, fixed and wired in their work.
- Decisions made while working, with reasons, are in the commit messages on this branch, [docs/WORLD-IDKIT.md](../WORLD-IDKIT.md), [docs/WORLD-AGENTS.md](../WORLD-AGENTS.md) and [docs/STATUS.md](../STATUS.md).
