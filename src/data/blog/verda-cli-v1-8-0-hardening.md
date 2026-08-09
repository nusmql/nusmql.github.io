---
author: Lei
pubDatetime: 2026-08-09T18:00:00Z
title: "Verda CLI v1.8.0: A Hardening Release — Vendored TUI, Adversarial AI Review, and Lessons Learned"
slug: verda-cli-v1-8-0-hardening
featured: false
draft: false
tags:
  - release
  - cli
  - ai-agents
  - infrastructure
description: Verda CLI v1.8.0 is out. Beyond the changelog, this release is the result of moving our TUI core in-tree and an adversarial two-model review of the entire codebase. These are the lessons.
locale: en
translationKey: verda-cli-v1-8-0-hardening
---

_I'm the author of [verda-cli](https://github.com/verda-cloud/verda-cli) at [Verda Cloud](https://verda.com). Personal notes on what went into [v1.8.0](https://github.com/verda-cloud/verda-cli/releases/tag/v1.8.0), and what the process taught me._

## Table of contents

## What shipped

v1.8.0 is a hardening release. The short list:

- **The TUI core lives in the CLI repo now** (`pkg/tui`, `pkg/log`, `pkg/version` — vendored from [verdagostack](https://github.com/verda-cloud/verdagostack) v1.4.2). No external module, no `replace` dance.
- A real user-reported bug fixed ([issue #54](https://github.com/verda-cloud/verda-cli/issues/54)): the `vm create` wizard silently discarded a block volume you had just added if you re-picked "None (skip)" — cursor on row 0, one Enter, work gone.
- **Pricing semantics corrected** (verified against the live API twice): `price_per_hour` is the instance's *total* hourly price; one dashboard path multiplied it again by the GPU/vCPU count.
- Agent mode grew real guardrails: prompts block fast with structured errors, destructive actions require `--yes` everywhere, usage errors exit 2, `vm create`/`vm action` report `accepted` and only poll with an explicit `--wait`.
- The wizard engine got a proper fix pass: a data race, an infinite-rewind path, inline validation errors, and an honest cancel contract.
- `verda update` and the curl-pipe installer now verify checksums **fail-closed**, against the signed sums the release pipeline already published.
- The MCP server: init race fixed, destructive tools require `confirm: true`, silently-coerced arguments now error out.
- A new hermetic **contract test suite**: the real binary against an in-process mock API — no network, no sleeps, runs in `make test`. Tests now run with `-race`.

That's roughly twenty fixes, each with a regression test or a wire-level contract pin.

## Lesson 1: vendor your TUI core when iteration friction hurts

The TUI stack used to live in `verdagostack`, a separate repo. Every small wizard tweak meant: change the other repo, review, tag a release, bump the dependency here, verify. Days for a one-line hint fix.

We had a `replace => ../verdagostack` workflow for local iteration, but it never worked in CI and kept drifting from what we shipped. So we copied the packages in-tree (they were Apache-2.0, same org, tagged v1.4.2 — the cleanest possible move point) and deleted the dependency.

The payoff was immediate: the wizard-engine race we found during the review got fixed and regression-tested in the same commit as everything else, under `-race`, in the same CI. One trap worth sharing: our `.gitignore` had a boilerplate `*testing` pattern that silently swallowed the `pkg/tui/testing/` directory — everything looked green locally while the pushed branch couldn't compile. I now distrust generous gitignore templates by default.

Upstream keeps its copy (other consumers exist); ours is ahead now. If the fixes prove out, I'll port them back.

## Lesson 2: adversarial AI review works — if you demand evidence

This release is the first where the core refactors came out of a structured two-model review, and I'd do it again:

1. **Eight parallel review passes** over the repo (pricing, agent contract, wizard engine, update path, MCP, registry/object storage, …), each required to report file:line evidence.
2. **Independent re-verification** of the top findings by a second model — adversarially. It reproduced the race, the agent-mode hang, and the timeout clamp itself.
3. **Live ground truth on staging** when the two reviewers disagreed. The pricing question — is `price_per_hour` per-unit or total? — had flipped twice in our docs' history. Both reviewers caught themselves reasoning in circles; a ~$0.003 experiment (create the cheapest on-demand instance, read the field) settled it permanently. We froze the answer in a JSON fixture with a regression test, because docs had already proven to be a weak oracle.

The second pass mattered more than the first: it caught that my decisive experiment was ratio-invariant and only discriminative in one direction, then found better evidence in our own git history. SOTA models are excellent at finding suspicious code and terrible at knowing when they've actually proven something — so the workflow has to force proof: reproduce it, or test it live, or it doesn't count.

Every fix then landed as its own commit with a failing test written first. Nineteen of them.

## Lesson 3: the skills/runbook is a shipped surface, not docs

We embed agent skills in the CLI (`verda skills install` — decision engine + command reference for coding agents). The hardening changed half a dozen agent-visible behaviors — new `--yes` gates, wait semantics, exit codes — and the skill files had quietly drifted from all of them. `skills status` version-checks only help if you bump the manifest; we do now (1.1.0 → 1.2.0 for the new targets).

Since agents are multiplying, install targets now also cover **Kimi Code, OpenCode, and Pi** — all three converge on the same `<name>/SKILL.md` convention, which makes this nearly free.

## Also worth noting

- CI pinned `golangci-lint` v2.5.0 while every dev machine drifted to v2.11 — two "green" states, one repo. Pins everywhere now, and the CI security lane (gosec with no config) is part of the local gates too.
- `make test` never ran the linter despite the docs saying so. Drift like this is invisible until it isn't.

## What's next

Serverless integration is in the works — containers and batch jobs as first-class `verda` commands. More soon.

---

_The full release: [verda-cli v1.8.0](https://github.com/verda-cloud/verda-cli/releases/tag/v1.8.0). The big PRs: [#55](https://github.com/verda-cloud/verda-cli/pull/55) (TUI vendored), [#56](https://github.com/verda-cloud/verda-cli/pull/56) (wizard storage fix), [#57](https://github.com/verda-cloud/verda-cli/pull/57) (hardening)._
