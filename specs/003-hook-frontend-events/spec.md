# Feature Specification: Hook System Frontend & Event Integration

**Feature Branch**: `003-hook-frontend-events`  
**Created**: 2026-02-20  
**Status**: Draft  
**Input**: User description: "Platform Hook System Phase 3 (Frontend Management UI) and Phase 4 (Service Layer Event Integration) — providing a web interface for hook management and wiring real event emission into the service layer."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - View and Browse All Configured Hooks (Priority: P1)

A user opens the Hook Management page from the AgentStudio settings area and sees a consolidated list of all hooks — both global and project-scoped. Each hook shows its name, associated event type, action type, scope, enabled/disabled status, and last execution result at a glance. Users can filter by scope (global, project, agent) and by event category (run, message, tool, task, schedule, system) to quickly locate specific hooks.

**Why this priority**: Without the ability to see existing hooks, no other management action (edit, delete, toggle) is possible. This is the foundation for the entire management UI and delivers immediate value by making the hook system visible and inspectable.

**Independent Test**: Can be fully tested by navigating to the hook management page and verifying the list renders correctly with sample hooks pre-configured via the existing REST API. Delivers the value of visibility — users can see what automations are configured.

**Acceptance Scenarios**:

1. **Given** the user has 5 global hooks and 3 project-scoped hooks configured, **When** they open the Hook Management page, **Then** all 8 hooks appear in the list with their name, event type, action type badge, scope badge, and enabled/disabled status clearly displayed.
2. **Given** hooks exist across multiple event categories, **When** the user filters by the "tool" category, **Then** only hooks listening to `tool.call_start` or `tool.call_end` events are shown.
3. **Given** no hooks have been configured, **When** the user opens the Hook Management page, **Then** an empty state is shown with guidance on how to create the first hook.
4. **Given** the user has hooks for multiple projects, **When** they filter by "project" scope and select a specific project, **Then** only hooks associated with that project are displayed.

---

### User Story 2 - Create a New Hook (Priority: P1)

A user wants to automate an action in response to a platform event. They click a "Create Hook" button, which opens a creation form. The form guides them through: naming the hook, selecting an event type from a grouped dropdown (14 events across 5 categories), choosing the action type (shell command, script path, or webhook URL), setting the scope (global, project, or agent), and optionally configuring execution options such as timeout, failure policy, and priority. Upon saving, the new hook appears in the list and is enabled by default.

**Why this priority**: Creating hooks is the core value proposition — users cannot benefit from the hook system at all without this capability. This is equally important as viewing hooks; together they form the minimal viable management UI.

**Independent Test**: Can be fully tested by creating a new hook via the UI, verifying it appears in the hook list, and confirming it was persisted by refreshing the page. Delivers immediate value by enabling users to set up automations without editing JSON files.

**Acceptance Scenarios**:

1. **Given** the user is on the Hook Management page, **When** they click "Create Hook," **Then** a creation form opens with all required fields: name, event type, action type, and scope.
2. **Given** the user is filling out the creation form, **When** they open the event type selector, **Then** the 14 available event types are shown grouped by category (Run, Message, Tool, Task, Schedule, System) with descriptions.
3. **Given** the user selects "Shell" as the action type, **When** they fill in the command field and save, **Then** the hook is created with the shell command action, default timeout (30 seconds), "ignore" failure policy, and priority 10.
4. **Given** the user selects "Webhook" as the action type, **When** they configure the URL, HTTP method, optional headers, and body template, **Then** the hook is saved with the full webhook configuration.
5. **Given** the user selects "Script" as the action type, **When** they specify the script path and optional arguments, **Then** the hook is saved with the script execution configuration.
6. **Given** the user selects "project" scope, **When** they are prompted for a project, **Then** a project selector appears letting them choose which project this hook applies to.
7. **Given** the user submits a creation form with a missing required field (e.g., no name or no event type), **When** they click save, **Then** a validation error is displayed inline and the form is not submitted.

---

### User Story 3 - Edit and Delete Existing Hooks (Priority: P2)

A user wants to modify an existing hook's configuration (change the command, event type, timeout, etc.) or remove a hook entirely. From the hook list, they can click on a hook to open an edit form pre-populated with the hook's current settings, make changes, and save. They can also delete a hook with a confirmation prompt.

**Why this priority**: Once hooks are created, users inevitably need to refine or clean up their configurations. This is the second most important management capability after creation.

**Independent Test**: Can be tested by editing a hook's name and command, verifying the changes persist, then deleting a hook and verifying it no longer appears.

**Acceptance Scenarios**:

1. **Given** a hook named "Auto Format" with a shell command action exists, **When** the user clicks edit, **Then** the edit form opens pre-filled with the hook's current name, event type, action configuration, scope, and execution options.
2. **Given** the user changes the hook's command from `npm run format` to `npm run lint && npm run format`, **When** they save, **Then** the hook is updated and the change is reflected in the hook list immediately.
3. **Given** the user clicks delete on a hook, **When** a confirmation prompt appears and the user confirms, **Then** the hook is removed from the list and from storage.
4. **Given** the user clicks delete on a hook, **When** the confirmation prompt appears and the user cancels, **Then** the hook remains unchanged.

---

### User Story 4 - Toggle Hooks On/Off (Priority: P2)

A user wants to temporarily disable a hook without deleting it (e.g., to pause an automation during debugging). From the hook list, each hook has an enable/disable toggle. Toggling the switch immediately updates the hook's status.

**Why this priority**: Quick enable/disable is essential for day-to-day hook management — users need to pause automations without losing configuration. This is a lightweight but high-frequency action.

**Independent Test**: Can be tested by toggling a hook off, verifying it shows as disabled, and confirming that it does not execute when the associated event fires.

**Acceptance Scenarios**:

1. **Given** a hook is currently enabled, **When** the user toggles it off, **Then** the hook status changes to disabled and the visual indicator reflects this immediately.
2. **Given** a hook is currently disabled, **When** the user toggles it on, **Then** the hook status changes to enabled and it will be eligible for execution on its next matching event.
3. **Given** a disabled hook exists, **When** the corresponding event fires, **Then** the hook is skipped and no execution record is created for it.

---

### User Story 5 - Test a Hook with Synthetic Events (Priority: P2)

A user has just created or edited a hook and wants to verify it works before waiting for a real event. They click a "Test" button on the hook, which sends a synthetic event matching the hook's event type. The system executes the hook and shows the result (success/failure, output, duration) inline.

**Why this priority**: Testing is critical for user confidence — without it, users can only verify hooks by triggering real events, which is slow and error-prone. This capability reduces setup friction significantly.

**Independent Test**: Can be tested by creating a hook with a simple shell command (e.g., `echo "hello"`), clicking "Test," and verifying the output appears with success status and execution duration.

**Acceptance Scenarios**:

1. **Given** a hook configured to trigger on `run.end` with a shell command `echo "hook fired"`, **When** the user clicks "Test," **Then** the system generates a synthetic `run.end` event, executes the hook, and displays the output `hook fired` with success status and execution duration.
2. **Given** a hook configured with a webhook action, **When** the user clicks "Test," **Then** the system sends the synthetic event payload to the webhook URL and displays the HTTP response status.
3. **Given** a hook whose action would fail (e.g., invalid command), **When** the user clicks "Test," **Then** the system displays the failure status, error message, and exit code.
4. **Given** a test execution is in progress, **When** the user sees the test button, **Then** a loading indicator is shown until the result returns.

---

### User Story 6 - View Execution History (Priority: P3)

A user wants to understand how their hooks have been performing — which ones fired recently, whether they succeeded or failed, and how long they took. The Hook Management page includes an execution history section showing recent executions across all hooks, with the ability to filter by specific hook, event type, or success/failure status.

**Why this priority**: Execution history provides observability and is essential for debugging, but users can still create, manage, and test hooks without it. It becomes more valuable as the system matures and hooks run frequently.

**Independent Test**: Can be tested by triggering several hook executions (via test or real events), navigating to the execution history view, and verifying the records show the correct hook name, event type, timestamp, duration, and success/failure status.

**Acceptance Scenarios**:

1. **Given** several hooks have been executed recently, **When** the user opens the execution history view, **Then** they see a chronological list of recent executions showing: hook name, event type, timestamp, duration, and success/failure badge.
2. **Given** a hook execution failed, **When** the user clicks on the execution record, **Then** they see the error message, exit code (for shell/script), or HTTP status (for webhook).
3. **Given** the user wants to see only failed executions, **When** they filter by "failed" status, **Then** only execution records with errors are displayed.
4. **Given** the user wants to see executions for a specific hook, **When** they filter by hook name, **Then** only that hook's execution records are shown.

---

### User Story 7 - Events Fire Automatically During Agent Sessions (Priority: P1)

When a user interacts with an agent (via the chat UI or via an A2A call), the platform automatically emits events at the appropriate lifecycle points: when a session starts, when the user submits a message, when the agent replies, when tools are called, and when the session ends or errors. These events flow through the existing PlatformEventBus to the HookManager, which dispatches matching hooks. The user does not need to take any action — events fire transparently in the background.

**Why this priority**: Without actual event emission, the entire hook system is inert. No hooks will ever fire during real usage. This is the bridge that turns the hook framework from a static configuration tool into a live automation system.

**Independent Test**: Can be tested by configuring a hook for `run.end` with a shell command that writes to a log file, then running an agent session to completion, and verifying the log file was written. This proves end-to-end event flow without depending on the UI.

**Acceptance Scenarios**:

1. **Given** a hook is configured for `run.start`, **When** a user starts a new agent session via the chat UI, **Then** the hook fires with the session ID, project ID, agent ID, and engine type in the event data.
2. **Given** a hook is configured for `run.end`, **When** an agent session completes normally, **Then** the hook fires with the session duration and message count in the event data.
3. **Given** a hook is configured for `run.error`, **When** an agent session encounters an error, **Then** the hook fires with the error message and error code in the event data.
4. **Given** a hook is configured for `message.user_submit`, **When** a user sends a message in the chat, **Then** the hook fires with the message content and sender information.
5. **Given** a hook is configured for `message.agent_reply`, **When** the agent finishes its reply, **Then** the hook fires with the reply content length and number of tool calls.
6. **Given** a hook is configured for `tool.call_start`, **When** the agent invokes a tool, **Then** the hook fires with the tool name and tool ID.
7. **Given** a hook is configured for `tool.call_end`, **When** a tool invocation completes, **Then** the hook fires with the tool name, success status, and tool ID.
8. **Given** a hook is configured for `run.start`, **When** an agent session is initiated via an A2A call (not through the chat UI), **Then** the same `run.start` event fires with identical structure, proving protocol-agnostic behavior.

---

### User Story 8 - Non-Blocking Hook Execution (Priority: P1)

When events fire during an agent session, hook execution never blocks or delays the user's interaction. If a hook takes a long time to execute or fails entirely, the agent session continues uninterrupted. Users see no degradation in chat responsiveness regardless of how many hooks are configured or how long they take.

**Why this priority**: Non-blocking execution is a constitutional requirement of the hook system. If hooks could block agent sessions, the system would be unusable in production. This must be guaranteed from day one.

**Independent Test**: Can be tested by configuring a hook with a long-running command (e.g., `sleep 60`), running an agent session, and verifying the session completes promptly without waiting for the hook.

**Acceptance Scenarios**:

1. **Given** a hook is configured with a 60-second shell command, **When** the associated event fires during a session, **Then** the session continues immediately and the hook runs in the background.
2. **Given** a hook execution fails (non-zero exit code, network error, timeout), **When** the failure policy is "ignore," **Then** no error is surfaced to the user and the session proceeds normally.
3. **Given** a hook execution fails, **When** the failure policy is "warn," **Then** a non-intrusive warning is logged but the session continues.
4. **Given** a hook exceeds its configured timeout, **When** the timeout expires, **Then** the hook execution is terminated, a timeout record is created in execution history, and the session is unaffected.

---

### Edge Cases

- What happens when the user creates a hook for an event type that no service currently emits (e.g., `task.submit` or `schedule.trigger`)? The hook is saved and will activate once the corresponding service emits that event in a future phase.
- What happens when multiple hooks match the same event? They execute in priority order (lowest number first). If two hooks have equal priority, execution order among them is unspecified but both will run.
- What happens when the hook storage file is corrupted or missing? The system initializes with an empty hook list and logs a warning. Existing in-memory hooks are unaffected until the next load.
- What happens when a webhook endpoint is unreachable? The webhook executor times out per the configured timeout, records the failure, and respects the failure policy.
- What happens when the user deletes a project that has project-scoped hooks? The hooks remain in storage but will never match events (no events will carry that project ID). They appear as orphaned in the UI and can be manually cleaned up.
- What happens when a hook's shell command tries to access an interactive terminal (e.g., prompts for input)? The shell executor runs with no stdin, so the command will fail with an EOF or input error. This is recorded as a failed execution.
- What happens when many hooks fire simultaneously (e.g., 20 hooks on `run.end`)? They execute concurrently up to a reasonable concurrency limit, without blocking the session.

## Requirements *(mandatory)*

### Functional Requirements

**Frontend Management UI**

- **FR-001**: System MUST provide a dedicated Hook Management page accessible from the application settings or navigation.
- **FR-002**: System MUST display all configured hooks in a list view showing: name, event type, action type, scope, enabled status, and last execution result.
- **FR-003**: System MUST allow users to filter hooks by scope (global, project, agent) and event category (run, message, tool, task, schedule, system).
- **FR-004**: System MUST provide a hook creation form with: name input, event type grouped dropdown (14 events across 5 categories), action type selector (shell, script, webhook), scope selector, and execution options (timeout, failure policy, priority).
- **FR-005**: System MUST provide dynamic form sections based on action type selection — shell shows a command input, script shows a path input with optional arguments, webhook shows URL/method/headers/body template inputs.
- **FR-006**: System MUST validate required fields before submission and display inline validation errors.
- **FR-007**: System MUST allow users to edit any existing hook, pre-populating the form with current values.
- **FR-008**: System MUST allow users to delete hooks with a confirmation step.
- **FR-009**: System MUST provide an inline toggle for enabling/disabling hooks without opening the edit form.
- **FR-010**: System MUST allow users to test any hook by sending a synthetic event matching the hook's event type, displaying the execution result (success/failure, output, duration) inline.
- **FR-011**: System MUST display an execution history view showing recent hook executions with: hook name, event type, timestamp, duration, and success/failure status.
- **FR-012**: System MUST allow users to filter execution history by hook name, event type, and execution status (success/failure).
- **FR-013**: System MUST display execution detail when a user clicks on an execution record: output text, error message, exit code, or HTTP response status as appropriate.
- **FR-014**: System MUST show an empty state with onboarding guidance when no hooks are configured.
- **FR-015**: System MUST support internationalization for all UI text via the existing i18n system.

**Service Layer Event Integration**

- **FR-016**: System MUST emit `run.start` events when an agent session begins, regardless of whether the session was initiated via the chat UI or an A2A call.
- **FR-017**: System MUST emit `run.end` events when an agent session completes normally, including session duration and message count.
- **FR-018**: System MUST emit `run.error` events when an agent session encounters an error, including the error message.
- **FR-019**: System MUST emit `message.user_submit` events when a user or caller submits a message, including message content and sender.
- **FR-020**: System MUST emit `message.agent_reply` events when the agent finishes a complete reply, including content length and tool call count.
- **FR-021**: System MUST emit `tool.call_start` events when a tool execution begins, including the tool name.
- **FR-022**: System MUST emit `tool.call_end` events when a tool execution completes, including the tool name and success status.
- **FR-023**: System MUST emit events from the service layer (SessionManager, EngineRunner), not from the protocol/route layer, ensuring engine-agnostic and protocol-agnostic behavior.
- **FR-024**: System MUST guarantee that event emission never blocks the request flow — all event handling and hook dispatch MUST be asynchronous and fire-and-forget from the emitter's perspective.
- **FR-025**: System MUST populate every emitted event with all available context: session ID, project ID, agent ID, source service identifier, and timestamp.
- **FR-026**: System MUST ensure the same event structure is emitted regardless of whether the request originated from the AGUI path (user chat) or the A2A path (agent-to-agent call).

### Key Entities

- **Hook**: A user-configured automation rule binding a platform event to an executable action. Key attributes: name, event type, action configuration, scope, enabled state, timeout, failure policy, priority.
- **Hook Event**: A structured message emitted by a platform service when a noteworthy action occurs. Key attributes: event type, timestamp, source service, session/project/agent context, and event-specific data payload.
- **Hook Execution Record**: A log entry capturing the result of a single hook execution. Key attributes: hook reference, event type, timestamp, duration, success/failure, output or error text, exit code or HTTP status.
- **Event Type**: A registered event definition specifying its type string, human-readable description, category grouping, and expected data schema. There are 14 event types across 5 categories (run, message, tool, task, schedule) plus system events.
- **Hook Action**: The executable payload of a hook — either a shell command, a script file reference, or a webhook HTTP call. Each action type has its own configuration shape.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can create a new hook through the management UI in under 60 seconds, selecting event type, action, and scope without consulting documentation.
- **SC-002**: Users can locate and modify any existing hook within 30 seconds using the filter/search capabilities.
- **SC-003**: 100% of hook creation, edit, delete, toggle, and test operations performed via the UI produce the correct result on first attempt (no data loss, no stale state).
- **SC-004**: Hook test execution results are displayed to the user within 5 seconds of clicking "Test" for hooks with actions that complete quickly (under 2 seconds).
- **SC-005**: Events for `run.start`, `run.end`, `run.error`, `message.user_submit`, `message.agent_reply`, `tool.call_start`, and `tool.call_end` fire correctly for 100% of agent sessions, both AGUI and A2A initiated.
- **SC-006**: Hook execution adds zero measurable latency to the agent session — the time between user message submission and first agent response token is not affected by the number or complexity of configured hooks.
- **SC-007**: Execution history accurately reflects all hook executions with correct timestamps, durations, and success/failure status — no missed or phantom records.
- **SC-008**: The hook management UI is fully functional and accessible without requiring the user to interact with JSON files, REST APIs, or terminal commands.
