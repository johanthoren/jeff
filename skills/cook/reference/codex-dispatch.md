# Codex native v2 dispatch

Read this when the orchestrator is running on Codex with native v2 agent tools. Every other host dispatches through the bullets in `skills/cook/SKILL.md` (§Dispatch), and the host-independent rules there still hold.

Read `agents/cook-<stage>.md` and inject its full role body into the child message. Choose a unique task-scoped `task_name`, then call `spawn_agent` with exactly `task_name`, `fork_turns: "none"`, and `message`; never pass model or effort because both inherit from the orchestrator. Persist the returned native task path/id and actual provider/model/effort when exposed. Specialist returns omit `agent_id`; pass the returned native task path/id as `<observed-agent-id>` when recording the JSON.

For parallel judgments, spawn every code review and required audit child, or every operation verify and required audit child, before the first `wait_agent`. Repeatedly wait for addressed `FINAL_ANSWER` messages, correlate each sender with its native task path/id, and collect every structured return independently. Persist whichever native lifecycle request (`interrupt_agent` or `close_agent`) the host exposes and its result or response. If a linked shutdown or cancel notification later arrives, correlate it; notifications do not require one. A bare `not_found` never proves cancellation.
