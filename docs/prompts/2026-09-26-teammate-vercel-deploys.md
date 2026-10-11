# Teammate Vercel deploys

Given to Claude Code (Claude Opus 5.5) in the Claude desktop app on 26 September 2026, in one session covering Sekisho, Tenjō, TradeBridge and Machi Voucher. The prompt is verbatim.

## Prompt

> across sekisho, tenjo, tradebridge and machi-voucher, can we create a webhook? my teammates want to deploy their solution and new ui, but they always need me to do so for redployment on vercel

## Follow-up

> we can just create a utc timestamp md file so its unique. then when the event ends, we can just clean it uo

## Notes

- The Vercel project is on a Hobby team, which only builds a private repository's commits when the owner authored them. Deploy hooks are held to the same check, so a deploy hook alone would not help.
- `.github/workflows/vercel-deploy.yml` commits a UTC-timestamped note to `.github/deploys/` as the owner when Vercel blocks a push to `main`, then reports Vercel's verdict and the production URL. A manual run on 26 September deployed `70a6e18` to production.
- No Vercel setting, secret or product code changed.
