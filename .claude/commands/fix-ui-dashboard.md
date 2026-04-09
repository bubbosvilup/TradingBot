Treat this as a dashboard/API task first.

Read:

- `AGENT.md`
- `docs/ai/project-map.md`
- `docs/ai/priorities.md`
- `docs/ai/rules/runtime-safety.md`
- `docs/ai/rules/testing.md`

Constraints:

- prefer changes in `public/`, `src/ui/`, and `src/core/systemServer.ts`
- avoid modifying trading semantics while fixing the dashboard
- preserve operator-facing payload compatibility unless the task explicitly asks for API changes
