# Task usage and cost: implementation boundary

Status: research and design only. No task token totals, provider prices, or costs are fabricated or enabled in this revision. The local manual planning modules have been removed at the user’s request. Existing browser records are untouched.

## Requested unit

One completed board task, potentially spanning multiple members, model turns and provider attempts. This is different from one session, one turn, or the difference between two session snapshots.

## Available plugin contract

- `task.start` validates the task revision and owner, then sends a message through the Team service. The result has a message ID when available, not a turn/run/attempt mapping.
- Task state is editable board metadata. `in_progress` does not prove execution started, and `completed` does not prove that all model calls ended.
- The session projection can report cumulative token counters. Reading a member's lifetime counter, or subtracting a start snapshot, cannot prove which task caused the usage. Concurrent work and inherited fork prefixes are additional sources of misattribution.
- Current client selectors intentionally do not subscribe to token usage. This revision does not silently change that behavior or present lifetime usage as a task total.

## Minimum reliable task ledger

A complete implementation needs a durable task-run ID attached to each execution request; a verified link to every contributing session/turn/provider attempt; provider-reported uncached input, output, cache-read and cache-write usage; deduplication across retries and forks; and an explicit completeness state. Missing counters remain unknown, never zero. Reopened tasks or later work require a new run or explicit inclusion policy.

Binding a whole turn manually is only valid if the turn exclusively belongs to that task. If a turn handles multiple tasks, a user-selected label cannot make its token usage separable. No automatic label or time window can recover missing attribution.

## Pricing and money

Historical rate records must identify provider, exact model/route, currency, effective interval and all applicable token categories or tiers. A present-day public price cannot establish what a past provider request cost. Multiple routes or failed/retried attempts require their own records. A computed amount should be labelled a calculation, not an invoice, and distinguish missing/partial pricing from zero cost. Actual charged amounts require billing records, which the current plugin contract does not provide.

## Safe release choice

Ship the independently verified visual changes without a claimed task-cost feature. Add task usage only after the host provides a complete attribution and usage contract, or after a clearly scoped user-approved exclusive-run workflow can prove it. Do not restore a manual-budget placeholder as a substitute for actual usage.
