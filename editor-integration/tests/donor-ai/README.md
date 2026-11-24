# Aedifex AI regression fixtures

Source: `TangSY/aedifex@0c0906d74806c1035c459b498b33057ee9e6eb32`, `packages/editor/src/components/ai/`. License: `../../licenses/aedifex-MIT.txt`.

Run `node node_modules/vitest/vitest.mjs run --config vitest.ai.config.ts` from the repository root. These 19 suites (550 cases) retain the source planner, catalog resolution, geometry validation, room analysis, layout, request contracts, and runtime-provider checks. Imports point to the migrated Pascal modules.

Source tests whose assertions require temporarily inserting ghost nodes into the formal store, pausing its history, or auto-committing a response were not carried over: those mechanisms violate the host integration contract. Replacement integration coverage is in `tests/integration/ai-full.test.ts` and `ai-full-browser.mjs`: detached candidates, manual confirmation, stale/cancel handling, native undo, multiround tool messages, cached catalog refresh, room reconciliation, and persistence. The source preset suite now checks captured snapshots; native restoration is covered by the host suite.

Passing this set does not mean every one of the 56 tool definitions has passed a real-provider or visual end-to-end test. The standalone source's room-preset backend remains unavailable.
