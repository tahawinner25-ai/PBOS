# The build team: agents and skills in `.claude/`

These are **build-time helpers** for Claude Code, not part of the shipped product. A visitor to PBOS never runs them, and
none of them has access to your users' data. They exist so that, when you or Claude work on this repository, specialist
instructions are available for reviewing, testing and fixing it.

> **PBOS product rules override anything written in these files.** If an agent or skill says something that conflicts with a
> rule in the README ("never invent metrics", "never publish or send without approval", "AI is always labelled", "no
> outcome promises"), the PBOS rule wins and the instruction is ignored. Known conflicts are listed below.

## Where they came from

- Source: ECC (<https://github.com/affaan-m/ECC>), MIT licence, version 2.2.3, commit `90606c8`. The licence is in
  `.claude/ECC-LICENSE`; the exact source note is `.claude/ECC-SOURCE.md`.
- Installed by copying files only. **Not** installed on purpose: hooks (they run shell commands on tool events), the
  installer scripts, slash commands, rules, MCP configs, and skills that ship scripts or hooks.
- **71 agents, not 63.** You mentioned 63. The commit I installed has 71 files in `.claude/agents/`, counted from the folder
  rather than from a README. I have not worked out which 8 account for the difference; if you have your list of 63, send it
  and I will mark the other 8.
- **53 skill folders:** 51 from ECC, plus two added for PBOS: `ui-ux-pro-max` (from the zip you attached; it only runs a
  local search over its own CSV files, no network or subprocess calls) and `21st-ui` (`docs/21st-dev.md`).
- The `Zcode` folder you mentioned was not touched, as you asked.
- Each agent runs as a Claude Code sub-agent and shares this session's usage limit. Two security-review sub-agents hit that
  limit during this build and returned nothing, so **no independent review has happened** (see `docs/SECURITY.md`).

## Agents that matter for PBOS, mapped to what they are for

| PBOS function | Agents to use | What for |
| --- | --- | --- |
| Planning a feature | `planner`, `architect`, `code-architect`, `code-explorer`, `spec-miner` | break work down, check it fits the existing patterns, extract the behaviour a change must keep |
| Code quality (TypeScript, React, Next.js) | `typescript-reviewer`, `react-reviewer`, `code-reviewer`, `code-simplifier`, `refactor-cleaner`, `type-design-analyzer` | review diffs, remove dead code, tighten types |
| First real `next build` | `build-error-resolver`, `react-build-resolver` | the build has never run; expect small errors the type stubs could not catch |
| Security and RLS (rules 1 to 20) | `security-reviewer`, `database-reviewer`, `silent-failure-hunter` | review auth, ownership filters, policies, swallowed errors; use with `docs/SECURITY.md` |
| Tests | `tdd-guide`, `pr-test-analyzer`, `e2e-runner` | write the failing test first; check a change is actually covered; drive the deployed app |
| In-app agent quality | `agent-evaluator`, `harness-optimizer` | score the agent's output (accuracy, completeness, clarity, actionability, conciseness) and its cost |
| Accessibility | `a11y-architect` | WCAG 2.2 AA work and review (`/accessibility` says what has and has not been tested) |
| Landing page and blog copy | `marketing-agent`, `seo-specialist` | positioning and copy, within the conflict rules below |
| Performance | `performance-optimizer` | the Studio and the dashboards |
| Docs and git | `doc-updater`, `comment-analyzer`, `docs-lookup`, `commit-reviewer` | keep docs and comments accurate; commit messages |
| Before making the repo public | `opensource-sanitizer` | scan for leaked secrets and personal data. `opensource-forker` and `opensource-packager` are not needed unless you open-source it |

Also available but optional: `gan-planner`, `gan-generator`, `gan-evaluator` (a generate-and-grade loop for UI work),
`conversation-analyzer`, `loop-operator`.

**Present but not relevant to this stack** (kept so the ECC copy stays whole; do not invoke them for PBOS):
`bengali-reviewer`, `cpp-*`, `csharp-reviewer`, `dart-*`, `flutter-reviewer`, `django-*`, `fastapi-reviewer`, `fsharp-reviewer`,
`go-*`, `harmonyos-app-resolver`, `healthcare-reviewer`, `homelab-architect`, `java-*`, `kotlin-*`, `mle-reviewer`,
`network-*`, `php-reviewer`, `python-reviewer`, `pytorch-build-resolver`, `rag-pipeline-reviewer`, `ruby-reviewer`,
`rust-*`, `swift-*`, `vue-reviewer`, and `chief-of-staff`.

## Skills (53)

| Area | Skills |
| --- | --- |
| Front end and design | `frontend-patterns`, `react-patterns`, `react-performance`, `react-testing`, `nextjs-turbopack`, `design-system`, `ui-ux-pro-max`, `21st-ui`, `seo` |
| Accessibility | `accessibility`, `frontend-a11y` |
| Back end and data | `backend-patterns`, `api-design`, `postgres-patterns`, `database-migrations`, `error-handling` |
| Security | `security-review`, `security-scan`, `agent-security-hardening` |
| Quality and release | `tdd-workflow`, `e2e-testing`, `browser-qa`, `click-path-audit`, `verification-loop`, `production-audit`, `canary-watch`, `deployment-patterns`, `change-impact`, `coding-standards`, `santa-method`, `council`, `architecture-decision-records` |
| AI features | `cost-aware-llm-pipeline`, `prompt-caching-strategy` |
| Product and market | `product-lens`, `product-capability`, `search-first`, `market-research`, `research-ops`, `deep-research`, `competitive-platform-analysis`, `competitive-report-structure` |
| Writing and brand | `article-writing`, `brand-voice`, `brand-discovery`, `content-engine`, `marketing-campaign` |
| Business operations | `investor-materials`, `investor-outreach`, `finance-billing-ops`, `customer-billing-ops`, `project-flow-ops`, `knowledge-ops` |

## Known conflicts with PBOS rules (the rule wins)

| File | What it says | Why PBOS differs |
| --- | --- | --- |
| `agents/marketing-agent.md` (landing page, "Social proof") | "structure for testimonials or stats (placeholder if launching without data)" | PBOS never shows placeholder or invented social proof, because a placeholder can be mistaken for the real thing. The landing page has none. Use a labelled "invented example" or nothing. |
| `agents/marketing-agent.md`, `skills/marketing-campaign` ("Closing CTA", urgency) | closing CTAs "with urgency" | Only a real deadline may be stated. PBOS makes no outcome promises. |
| `skills/investor-materials`, `skills/investor-outreach` | projections, traction and use-of-funds tables | PBOS has no users or revenue yet. Any number in investor material must come from a real record, and forecasts must say "Estimate, not guaranteed income." |
| `skills/finance-billing-ops`, `skills/customer-billing-ops` | operate Stripe subscriptions, refunds, charges | PBOS collects no payment and has no billing system. Not used. |
| `agents/chief-of-staff.md` | triage and reply to email, Slack, LINE, Messenger | PBOS never sends messages; it drafts for the creator to send. Not used. |
| `agents/loop-operator.md`, `agents/gan-*` | autonomous loops that iterate on their own | The product agent is capped and cannot publish, send, pay or delete. Build-time loops are fine; do not wire one into the product. |
| `skills/deep-research` | uses firecrawl and exa tools | Those tools are not installed here. Do not invent sources when they are missing. |

## How to use them

Ask Claude Code in plain words, for example: "have the security reviewer check `src/actions/publish.ts` against
`docs/SECURITY.md`" or "run the TDD guide on the new deal-stage rule". Read what comes back before applying it. A review by
an agent is a second opinion, not proof.
