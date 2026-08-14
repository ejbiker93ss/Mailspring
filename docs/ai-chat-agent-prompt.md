# FlashMail AI chat: implementation prompt for an AI coding agent

> This file is an implementation prompt, not a product overview. Read it
> before changing FlashMail's AI sidebar assistant, its API route, its tool
> loop, conversation persistence, or any AI proposal card.

## Your role

You are modifying an existing production webmail application called
FlashMail. Treat the current implementation and generated API contract as the
source of truth. Do not replace the chat architecture with a generic chatbot,
a server-side autonomous agent, or a new provider SDK.

Before editing:

1. Read this document.
2. Read the relevant sections of:
   - [`artifacts/webmail/src/components/mail/AIChatPanel.tsx`](../../webmail/src/components/mail/AIChatPanel.tsx)
   - [`artifacts/api-server/src/routes/ai.ts`](../src/routes/ai.ts)
   - [`lib/api-spec/openapi.yaml`](../../../lib/api-spec/openapi.yaml)
   - [`lib/api-client-react/src/generated/api.ts`](../../../lib/api-client-react/src/generated/api.ts)
   - [`lib/api-zod/src/generated/api.ts`](../../../lib/api-zod/src/generated/api.ts)
3. Search for the existing analogous card, tool, route, and test before
   adding a new one.
4. Keep provider calls, authenticated mailbox calls, and user confirmation
   behavior in their existing layers.

When this prompt says “the server,” it means the API server route. When it
says “the client,” it means the webmail React application.

## Non-negotiable architecture

FlashMail AI chat is a **client-orchestrated, stateless exchange loop**.

```text
browser
  -> POST /api/ai/chat
     server validates request
     server builds grounded prompt
     server calls configured AI provider
     server parses text protocol blocks
  <- terminal reply OR one intermediate instruction

browser executes permitted client-side work
  -> appends a validated completed step
  -> POSTs the same transcript plus agentSteps
  -> server calls the model again
```

The server does all of the following:

- authenticates the FlashMail session;
- resolves the AI provider configuration for the `chat` operation;
- validates all request fields with Zod;
- validates attachments against live configuration;
- constructs the system prompt, grounding block, tool instructions, and
  transcript;
- calls the configured AI provider;
- strips and parses `<<<TOOL ... TOOL>>>` and `<<<ACTIONS ... ACTIONS>>>`
  blocks;
- canonicalizes folders and validates that proposed message targets were
  actually shown to the model;
- executes only explicitly server-owned read tools such as contact/rule
  listing;
- mints user-confirmation proposals for writes; and
- persists terminal exchanges.

The server does **not**:

- call the mail search route to execute `search_messages`;
- move, delete, archive, flag, or mark messages read from an AI tool block;
- send a reply or new email from a tool block;
- create calendar events from a tool block;
- create contacts from a tool block;
- mutate user settings, rules, forwarding, auto-responder, Quick Steps, or
  custom actions directly from a model request;
- trust a model-supplied mailbox, destination folder, display row, or
  recipient without server validation; or
- store attachment bytes in a conversation.

The client does all user-account-scoped execution through existing generated
authenticated APIs and existing mutation helpers. Every user-visible write
must be confirmation-gated unless it is an explicitly idempotent/navigation
behavior already implemented by the panel.

## Main implementation locations

| Concern                                          | Source                                                            |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| Chat panel, loop, cards, attachments, history UI | `artifacts/webmail/src/components/mail/AIChatPanel.tsx`           |
| AI feature export/lazy boundary                  | `artifacts/webmail/src/components/mail/ai-features.ts`            |
| Mail-page mounting and account/folder inputs     | `artifacts/webmail/src/pages/mail.tsx`                            |
| Public AI routes and schemas                     | `artifacts/api-server/src/routes/ai.ts`                           |
| Generated request/response contract              | `lib/api-spec/openapi.yaml`                                       |
| Generated React client                           | `lib/api-client-react/src/generated/api.ts`                       |
| Generated Zod contract                           | `lib/api-zod/src/generated/api.ts`                                |
| AI provider abstraction                          | `lib/ai-client/src/index.ts`                                      |
| AI provider/job configuration                    | `artifacts/api-server/src/services/ai-call-config.ts`             |
| Prompt templates, guardrails, limits, toggles    | `artifacts/api-server/src/services/ai-prompts.ts`                 |
| Chat draft persistence                           | `artifacts/webmail/src/lib/ai-chat-draft-store.ts`                |
| Conversation persistence schema                  | database schema containing `aiConversationsTable`                 |
| Chat tests                                       | `artifacts/webmail/src/components/mail/AIChatPanel.test.tsx`      |
| Agent-route tests                                | `artifacts/api-server/src/__tests__/ai-agent-tools.route.test.ts` |

Generated client and Zod files are code-generation output. Change
`lib/api-spec/openapi.yaml` first, then run the repository's code generation;
do not hand-edit generated files.

## Feature availability and gates

### `/api/ai/config`

`GET /api/ai/config` is available to any signed-in user and is registered
before the AI generation gate. It returns at least:

```ts
{
  globallyEnabled: boolean;
  effectivelyEnabled: boolean;
  sidebarAssistantEnabled: boolean;
  threadSummaryEnabled: boolean;
  meetingSuggestEnabled: boolean;
  quotedTextSummaryEnabled: boolean;
  subjectSuggestEnabled: boolean;
  replyDraftSuggestEnabled: boolean;
  followupTriageEnabled: boolean;
  attachments: {
    enabled: boolean;
    maxImageBytes: number;
    maxFileBytes: number;
    maxTotalBytes: number;
    maxPerMessage: number;
    acceptedImageTypes: string[];
    acceptedFileTypes: string[];
    pdfSupported: boolean;
  };
}
```

`effectivelyEnabled` includes the admin master switch plus allowed tester or
Domain-Admin beta access. The client must use `effectivelyEnabled`, not only
`globallyEnabled`, when deciding whether the AI UI is available.

Every AI affordance is a client-side four-way AND:

```text
effectivelyEnabled
&& admin feature toggle
&& preferences.aiFeaturesEnabled (default true)
&& preferences.<feature-specific preference> (default true)
```

The server enforces admin/global gates and returns `503` for disabled
generation routes. It does not enforce personal preferences; the client owns
that layer.

The AI route has `requireSession` first. `/config`, stored summary reads, and
conversation CRUD are registered before the global-disabled generation gate,
so users can still inspect stored history and summaries while generation is
off. Do not gate the conversation-history query on the panel's broad
`unavailable` state.

Generation failures use structured errors, commonly:

```json
{
  "error": "ai_unavailable",
  "reason": "globally_disabled"
}
```

or:

```json
{
  "error": "ai_unavailable",
  "reason": "credentials_missing"
}
```

Feature-specific admin toggles use `reason: "feature_disabled"`.

## What the panel sends

The primary request is `POST /api/ai/chat`.

The request is not a complete permanent transcript. The browser sends a
bounded recent window, and the server stores the full conversation separately.

### Request shape

```ts
type AIChatRequest = {
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>; // 1..20, each content 1..8000 chars

  context?: AIEmailSnippet[]; // max 150
  folderName?: string;
  openMessage?: {
    uid?: string;
    folder?: string;
    subject?: string;
    from?: string;
    date?: string;
    body?: string; // max 20,000 chars at request validation
  };
  nowISO?: string;
  timeZone?: string;
  mailbox?: string;
  conversationId?: number;

  grantedFolders?: string[]; // max 300
  folders?: string[]; // max 300
  agentSteps?: AIAgentStep[]; // max 6

  calendarToolsEnabled?: boolean;
  rulesToolsEnabled?: boolean;
  settingsToolsEnabled?: boolean;

  trashFolder?: string;
  archiveFolder?: string;

  attachments?: AIChatAttachment[]; // max 5
  contextCheckpoint?: AIContextCheckpoint;
};
```

An email snippet is compact, client-selected grounding data:

```ts
type AIEmailSnippet = {
  subject?: string;
  from?: string;
  date?: string;
  snippet?: string;
  uid?: string;
  folder?: string;
  unread?: boolean;
  hasAttachments?: boolean;
};
```

The server does not fetch message bodies to fill `context`. The client passes
the exact redacted/trimmed data the model is allowed to see.

`mailbox` is the active account whose rows produced the grounding context.
The client must pin all context list requests to this mailbox. A fast account
switch during a send must fail ownership checks rather than leak rows from the
new account into the old request.

`folderName` identifies the active folder. `openMessage` is richer grounding
for the message currently visible in the reading pane. Do not treat the
active folder as the only folder the model can search.

`nowISO` includes the user's offset when possible. `timeZone` is an IANA zone.
Use these for relative dates; do not substitute the server's local timezone.

## Client context selection and budgeting

The panel always includes the active folder's compact rows. Users can select
extra folders per mailbox using the `aiContextFolders` preference:

- the preference is a map keyed by lowercase mailbox email;
- the `"*"` sentinel means all eligible folders and is expanded against the
  live folder list at read time;
- Junk, Spam, Trash, and the active folder are not extra-folder choices;
- toggling one folder out of all-mode materializes the explicit remainder;
- preference writes replace the whole map, not one nested key;
- deleted/renamed folders are pruned when the live list is resolved.

Extra-folder data is fetched **at send time**, not when the picker is toggled:

- only the first 12 selected extra folders receive eager snapshots;
- the total eager extra-row budget is 120 rows;
- per-folder rows are clamped between 5 and 25;
- cache-only `GET /api/mail/messages?source=cache` reads are used;
- list requests use `mailbox=<panel account>`;
- at most 6 extra-folder reads run concurrently;
- a `mailbox|folder` client ref cache lasts 60 seconds and must be reused
  only when it has at least as many rows as the current send needs;
- each extra snippet preview is capped to 160 characters;
- a failed folder contributes no rows and does not fail the chat send.

The active folder contributes up to 25 richer rows. Therefore:

```text
active rows (<= 25) + extra rows (<= 120) = <= 145
```

This stays below the request's 150-row `context` cap.

Folders selected beyond the eager snapshot limit, or granted through an
inline access card with no snapshot rows, are **search-only**. The server
derives this from the original pre-trim context and `grantedFolders`; the
client does not send a separate search-only field.

The server's `trimContextToBudget` is the only cap for the rendered context
block. It must be the same input to both:

1. `buildContextBlock`; and
2. suggested-action grounding.

Never validate an action against raw untrimmed context if the model was only
shown the trimmed context.

The trim order is:

1. clamp snippets (active 500 chars, extra 200 chars);
2. round-robin drop oldest extra rows per folder;
3. reduce active snippets to 160 chars;
4. drop oldest active rows while keeping at least one.

The server adds coverage text for visible folders and a separate line for
search-only folders:

```text
OTHER FOLDERS IN YOUR CONTEXT SCOPE (no messages shown from these)
```

The model must use `search_messages` to reach those folders. Search-only
folders contribute zero rows.

## Conversation window and compaction

The client keeps the full in-memory transcript for rendering, but every
request sends only the last 20 turns. Each sent turn's content is capped to
8,000 characters by `buildRequestMessages`.

The server persists the full exchange, up to 200 stored turns per conversation.
The server can also compact old context:

1. The provider's `contextBudgetTokens` is read from the active `chat` job.
2. `0` disables proactive compaction.
3. The server estimates prompt tokens from system prompt plus transcript.
4. Grounding context is not included in this estimate, so the budget is soft.
5. Older turns are summarized into an `AIContextCheckpoint`.
6. A genuine provider context-overflow error triggers one reactive compact-and-
   retry attempt.
7. A failed proactive summary falls back to the uncompacted prompt.
8. A failed reactive summary surfaces the original provider overflow.

The checkpoint is client-carried:

```ts
type AIContextCheckpoint = {
  summaryText: string;
  coveredTurnCount: number;
};
```

The server's returned `coveredTurnCount` is relative to the turns sent in
that request. The client must translate it back to its absolute `turns` index:

```text
covered = current checkpoint coverage
tail = chainTurns.slice(covered)
windowStart = chainTurns.length - min(tail.length, 20)
foldCount = response.coveredTurnCount - covered
newAbsoluteCovered = min(windowStart + max(foldCount, 0), chainTurns.length)
```

Clamp the result so the newest turn is always retained. Omit the checkpoint
from a request when the covered count is zero. The checkpoint is conversation-
scoped state:

- New chat clears it.
- Opening history restores it, clamped to the loaded message count.
- The UI renders a condensed divider at the covered turn.
- The server persists a newly minted checkpoint on the conversation row.

Do not change `MAX_SENT_TURNS`, the client translation, or the server's
sent-relative semantics independently.

## The normal client send sequence

The authoritative flow is `AIChatPanel.runExchange`:

1. Build `openMessage`.
2. Fetch extra-folder snippets from the cache, with the active mailbox pinned.
3. Abort if the send-generation epoch changed.
4. Read the live checkpoint from its ref.
5. Build the bounded `messages` tail and translate checkpoint coverage.
6. Build the request with active context, extra context, account/folder data,
   capability flags, attachments, and folder hints.
7. Call `useAiChat().mutateAsync`.
8. Abort if the epoch changed.
9. Store any returned checkpoint.
10. Handle `folderAccessRequest`.
11. Handle `serverSteps`.
12. Handle `toolRequest`.
13. Otherwise append the terminal assistant turn and all response card fields.
14. Set the returned conversation ID/title and invalidate the history list.

The user's turn is inserted optimistically before the request. If generation
fails, keep that user turn so Retry can resend it.

### Generation epoch guard

`sendGenRef` is incremented when the user starts a new chat, opens another
conversation, or presses Stop. Capture `gen` at send time and check it:

- after the initial `mutateAsync`;
- after fetching extra context;
- after each client-executed tool;
- before every recursive `runExchange` call;
- in the terminal success path; and
- in the catch path.

When the epoch does not match, discard the result completely. A late response
must never append to a newly opened conversation or rebind its
`conversationId`.

Stop is cooperative. It increments the epoch, calls `chat.reset()`, and
clears agent activity/pending access. It does not abort the server HTTP
request. The user turn remains in the transcript.

## Attachments

Attachments are stateless request data. They are not uploaded to the mail
server and are not persisted as bytes in the chat conversation.

```ts
type AIChatAttachment = {
  name: string;
  mimeType: string;
  dataBase64: string; // standard base64, no data: prefix
};

type AIChatAttachmentMeta = {
  name: string;
  mimeType: string;
  sizeBytes: number;
  kind: 'image' | 'pdf' | 'text';
};
```

The client:

- reads staged files into base64;
- pre-validates against the policy from `/api/ai/config`;
- sends files on the initial round;
- sends the exact same payload on every tool-loop round;
- sends them again on a pending-access resume;
- keeps them in `lastSentAttachmentsRef` for Retry; and
- persists only byte-free metadata on the user turn.

Restored attachment chips are inert because their bytes are gone.
Attachment-only sends are not allowed; `canSend` requires text.

The server re-validates on **every round** against live admin configuration
and the active provider. Validation order is part of the security contract:

1. AI attachments enabled;
2. attachment count;
3. normalized MIME allow-list; SVG is not allowed;
4. PDF provider check;
5. strict base64 validation;
6. decode;
7. per-file size cap;
8. running total cap.

The hard decoded total ceiling is 15 MB. Admin configuration supplies the
image/file/per-message limits, and `/ai/config` must derive its byte policy
from the same server constants used by validation. Do not duplicate numeric
caps in the client.

Supported types are:

- images: PNG, JPEG, GIF, WebP;
- text-like files: plain text, CSV, Markdown, JSON, and log text;
- PDF only when the active `chat` provider is Anthropic.

Oversized JSON bodies must be rejected before base64 decoding by the
request/body limits. Return `400` with machine-readable attachment reasons:

```text
attachments_disabled
too_many_attachments
unsupported_attachment_type
invalid_attachment_data
attachment_too_large
attachments_total_too_large
pdf_unsupported_provider
```

Provider content rules:

- images and PDFs become native model content parts;
- text files become fenced text blocks appended after the normal transcript
  input cap;
- no-attachment turns keep `content` as a plain string for prompt stability;
- parts arrays are used only when attachments exist;
- the OpenAI path must fail loudly for PDFs rather than pretending support.

## Prompt assembly

The server loads admin prompt/rules configuration and fails open to defaults
on a configuration read failure.

For chat it assembles:

```text
shared guardrail block
  + resolved chat feature template with {context}, {now}, and {user}
  + context block if the template omitted {context}
  + suggested-actions emission instruction
  + agent-tool instruction when the request opts into agent mode
```

The suggested-actions and agent-tool instructions are appended outside the
admin-editable template. This guarantees that an administrator's custom
template cannot remove the machine-readable protocol contract.

The transcript sent to the model is:

```text
EARLIER CONVERSATION (condensed summary...)  [optional]
User: ...
Assistant: ...
TOOL RESULTS FROM THIS TURN: ...              [optional]
attached text-file blocks                     [optional]
```

The normal conversation text is subject to the active operation's input cap.
The checkpoint, tool results, and attached text blocks are appended outside
that cap so the newest grounding/tool/file data is not silently removed.

If `stripExternalLinks` is enabled, apply it to visible AI prose only after
machine blocks have been extracted. Never strip links before parsing JSON
blocks.

## Text protocol blocks

The model uses text blocks instead of provider-specific function calling.
Blocks must be at the end of the model response.

### Tool block

```text
<<<TOOL
{"name":"search_messages","folder":"Receipts","query":"from:replit receipt","limit":50}
TOOL>>>
```

The server extracts the tool block before suggested actions. A malformed,
unsupported, or capability-disabled block must not leak raw markup to the
user.

The server parses only a valid tool block and strips the block from the visible
reply. It canonicalizes folder casing against the `folders` list.

### Suggested-action block

```text
<<<ACTIONS
[{"type":"create_task","uid":"123","folder":"Inbox","title":"Reply to the
deadline request","priority":"high","dueDate":"2026-08-14T17:00:00-05:00"}]
ACTIONS>>>
```

Rules:

- The block must be at the end after prose.
- The only type is `create_task`.
- Maximum three actions.
- `uid|folder` must appear in the trimmed context or `openMessage`.
- Folder matching is case-insensitive.
- Duplicate anchors are dropped.
- Invalid due dates are removed.
- The server stamps the active mailbox; the model never supplies it.
- Every ac…222 tokens truncated… already has the underlying mailbox permissions.

On a `search_messages` request:

1. Canonicalize the requested folder against `folders`.
2. Compare it case-insensitively with `grantedFolders`.
3. If not granted, return:

```json
{
  "reply": "optional short explanation",
  "folderAccessRequest": {
    "folders": ["Receipts"]
  }
}
```

4. The client shows an inline Allow/Deny card.
5. Allow adds the folder to session-local grants and re-posts the same
   transcript, prior steps, and attachments.
6. Deny appends a local “I won't search that folder” assistant note and does
   not re-post.

Folder grants and pending consent are scoped to the active mailbox. Clear them
on mailbox switch. A grant for `Receipts` on account A must not authorize
`Receipts` on account B.

### Client-executed tool results

For a client-executed tool, the server returns a `toolRequest`. The client
executes it with existing authenticated APIs and re-posts the completed result
in `agentSteps`.

The client branch order is mandatory:

1. `serverSteps`;
2. `toolRequest`;
3. terminal reply.

Search execution:

```ts
type SearchAgentStep = {
  tool: 'search_messages';
  folder: string;
  query: string;
  results: AIEmailSnippet[]; // max 50
  totalCount?: number;
};
```

The browser uses `searchMail({ q, folder, page: 1, pageSize: limit })`, caps
the result rows, records the real returned folder, and degrades a failed
search to an empty result step so the model reports no matches honestly.

Calendar execution:

- `list_events` is client-executed.
- Model-facing dates are local wall-clock strings.
- Client converts them to UTC ISO for the events API.
- Client filters the returned full-calendar response back to the requested
  overlap window because the upstream listing may ignore range parameters.
- Client converts returned times back to the user's local wall clock.
- Maximum 50 event snippets are returned.

Create-contact execution:

- The server validates and mints a `contactPlan`.
- The client calls the normal authenticated `createContact` endpoint.
- The request is pinned to `contactPlan.mailbox`.
- The client returns a `create_contact` step with the created UID or error.
- The server turns successful create steps into confirmation cards on the
  terminal response.
- A missing plan is terminal/failure; do not re-post a plan-less request.

### Server-executed steps

These tools are read-only or use server-owned local context, so the server
returns a completed step under `serverSteps`. The client appends those steps
to `agentSteps` and re-posts:

- `search_contacts`: searches synced contacts and groups across owned
  accounts, deduplicating by email and preferring personal contacts over GAL.
- `list_rules`: reads the active account's real rules.
- `list_quick_steps`: reads the primary user's Quick Steps visible for the
  active account.
- `get_settings`: reads display-safe values from the personal settings
  catalog; raw values are not sent to the model.

Server step shapes are validated on the next request. Keep result rows compact:

- contacts: max 25;
- rules: max 25;
- Quick Steps: max 25;
- settings: max 80;
- events/search rows: max 50;
- rendered tool-result prompt budget: 8,000 characters.

### Tool table

| Tool                   | Client/server behavior                 | Result or terminal behavior                              |
| ---------------------- | -------------------------------------- | -------------------------------------------------------- |
| `search_messages`      | Client search; folder consent required | `toolRequest`, then `search_messages` step               |
| `propose_moves`        | Server validates only                  | Confirm-gated move proposal                              |
| `propose_delete`       | Server validates only                  | Confirm-gated delete-to-trash proposal                   |
| `propose_archive`      | Server validates only                  | Confirm-gated archive proposal                           |
| `propose_reply`        | Server validates only                  | Editable reply/forward composer card                     |
| `propose_email`        | Server validates only                  | Editable new-email composer card                         |
| `propose_print`        | Server validates only                  | Print proposal; user click opens print                   |
| `open_email`           | Server validates, client navigates     | Opens live on terminal response; card remains reopenable |
| `list_events`          | Client calendar listing                | `toolRequest`, then local-calendar step                  |
| `propose_event`        | Server validates only                  | Confirm-gated calendar create                            |
| `propose_event_delete` | Server validates only                  | Confirm-gated calendar delete                            |
| `search_contacts`      | Server executes read                   | `serverSteps`, then re-post                              |
| `create_contact`       | Client creates from server plan        | `toolRequest`, then contact-created card                 |
| `propose_contact_form` | Server validates only                  | Confirm/open contact form card                           |
| `create_contact_group` | Server validates only                  | Confirm-gated group create card                          |
| `list_rules`           | Server executes read                   | `serverSteps`, then re-post                              |
| `create_rule`          | Server validates only                  | Confirm-gated rule proposal                              |
| `update_rule`          | Server validates/grounds existing rule | Confirm-gated full replacement                           |
| `list_quick_steps`     | Server executes read                   | `serverSteps`, then re-post                              |
| `create_quick_step`    | Server validates only                  | Confirm-gated local preference write                     |
| `set_forwarding`       | Server validates only                  | Confirm-gated account setting                            |
| `set_auto_responder`   | Server validates only                  | Confirm-gated account setting                            |
| `create_custom_action` | Server validates only                  | Confirm-gated local preference write                     |
| `get_settings`         | Server executes read                   | `serverSteps`, then re-post                              |
| `update_settings`      | Server validates catalog values        | Confirm-gated personal preference patch                  |
| `open_settings`        | Server resolves catalog page           | Settings-location card                                   |

Capability flags:

- Calendar tools are enabled only for an account with calendar support.
- Rules tools require both the client flag and actual session capability.
- Quick Steps are FlashMail-local and do not require mail-rule capability.
- Settings tools are personal FlashMail preferences, never admin settings and
  never mailbox-pinned.

## Proposal safety and grounding

The model proposes. The server grounds and mints. The client confirms and
executes.

### Known-message grounding

`collectKnownMessages` combines:

- prior `search_messages` step results;
- current trimmed grounding snippets; and
- `openMessage`.

The key is:

```text
uid + "|" + folder.toLowerCase()
```

Never allow a model to invent a UID/folder pair or display details. Copy
subject/from/date from the trusted known row. Drop unknown or duplicate items.

### Move/delete/archive

- Move target folders must exist in the account's `folders` list.
- Delete/archive target folders are never model-chosen.
- Delete uses the client-supplied `trashFolder`, falling back to
  `Deleted Items`.
- Archive uses `archiveFolder`, falling back to `Archive`.
- Items already in their destination are dropped.
- Maximum 100 proposal items.
- Every proposal receives a server-generated opaque proposal ID.
- The client groups selected items by source folder and uses the existing
  optimistic bulk-move core.
- A move is only considered failed when the whole source-folder group fails.
  A missing `newUid` is UID-reconciliation lag, not per-item failure.

### Reply/forward/new email

`propose_reply`:

- must reference a known message;
- falls back to the currently open message if the target is omitted or
  unknown and an open message exists;
- validates and lowercases real email addresses;
- deduplicates recipients across To/Cc/Bcc;
- caps each field at 20 and the total at 50, trimming Bcc then Cc;
- falls back to the original sender for a reply with no valid To;
- does not use that fallback for a forward;
- derives `Re:`/`Fwd:` subject when the model omitted one;
- keeps the body plain text;
- forbids a model signature; the client adds the saved signature at send time;
- uses the normal authenticated send path with reply threading.

`propose_email` has no message anchor. It still validates recipients and
requires a subject, but an empty To is allowed so the user can complete the
editable composer card.

### Calendar proposals

Calendar proposal datetimes are local wall-clock strings. The client converts
them to UTC only when calling the calendar API. Attendees without resolvable
email addresses are shown but not invited. Event deletion grounds all display
details from the prior `list_events` step; the model supplies only the event
UID for deletion.

### Rules, settings, forwarding, and Quick Steps

All are proposal-only writes:

- rule creation/update is a full rule replacement;
- update IDs must be grounded against the real account rule list because
  upstream save is an upsert;
- `enabled` must be explicit on update so a disabled rule is not silently
  re-enabled;
- folder actions are canonicalized and checked when the target is active;
- forwarding requires a valid address;
- Quick Steps are saved unpinned and never occupy a header slot automatically;
- settings keys and values are validated against the shared settings catalog;
- settings writes are one preferences patch for the signed-in primary user;
- settings tools never modify admin settings.

Rule/forwarding operations may be pinned to the proposal mailbox with
`extraQueryParams.mailbox`. Personal settings are intentionally not
mailbox-pinned.

## Terminal cards and persistence

The terminal assistant turn may carry structured fields:

```text
actions
moveProposal
eventProposal
actionProposal
replyProposal
emailProposal
printProposal
openEmailProposal
contactsCreated
contactFormProposal
groupCreated
ruleProposal
quickStepProposal
forwardingProposal
autoResponderProposal
customActionProposal
settingsProposal
settingsLocation
```

The client must append every returned field to the live turn. `open_email` is
the exception to ordinary confirmation: the live exchange navigates
immediately, but restore never auto-navigates. Pass the just-returned
conversation ID to execution when the first exchange has not yet committed
`conversationId` to React state.

When adding a new structured card field, register it in all four whitelist
locations:

1. live terminal-turn mapping in `AIChatPanel`;
2. history restore mapping in `AIChatPanel`;
3. `GET /api/ai/conversations/:id` response serialization in `ai.ts`;
4. `persistChatExchange` storage fields in `ai.ts`.

Missing any one silently drops the card in one lifecycle. Add both server
history-route coverage and a client restore/resume test.

Auto-executing behavior must exist only in the live-send path. Never trigger a
side effect while restoring history.

### Conversation endpoints

| Method   | Endpoint                                                   | Contract                                                          |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------- |
| `GET`    | `/api/ai/conversations`                                    | Current user's metadata only, pinned first then updated time      |
| `GET`    | `/api/ai/conversations/:id`                                | Current user's full stored turns/cards/checkpoint                 |
| `PATCH`  | `/api/ai/conversations/:id`                                | `{ pinned: boolean }`                                             |
| `DELETE` | `/api/ai/conversations/:id`                                | Idempotent ownership-scoped delete, `204`                         |
| `POST`   | `/api/ai/conversations/:id/proposals/:proposalId/executed` | Bookkeeping stamp, optional `movedCount`, `eventUid`, or `ruleId` |

Conversations are scoped by signed-in `session.username`, not by active
mailbox. This is why every account-sensitive action card must carry a
server-stamped mailbox and the client must gate it against the currently
active account.

Persistence rules:

- title comes from the first user message, collapsed and capped at 60 chars;
- existing conversations append a user/assistant pair;
- stored transcript is capped to the newest 200 turns;
- unpinned conversations keep a rolling newest 10 per user;
- pinned conversations are capped at 10;
- a pin beyond the cap returns `409 pin_limit_reached`;
- a deleted/evicted referenced conversation starts a fresh conversation;
- persistence is best effort: a DB failure must not turn a successful AI
  reply into a failed chat request;
- attachment bytes are never stored;
- executed stamps make restored cards inert/done.

`aiMarkProposalExecuted` is bookkeeping. If the actual mail/calendar/settings
operation succeeded, a bookkeeping failure must not report the operation as
failed to the user.

## Client execution invariants

### Account scoping

Cards that affect a specific account carry `mailbox`, stamped by the server.
On restore, compare the stamp with the current active mailbox again.

- Mail moves, delete/archive, print, open-email, and calendar cards are
  disabled on account mismatch.
- Rules and account settings can execute through their proposal mailbox pin.
- Quick Steps are account-sensitive and remain blocked on mismatch.
- Personal settings are per primary user and are not mailbox-pinned.
- Legacy cards without a mailbox use the existing compatibility fallback only
  where the current code explicitly supports it.

Never widen a proposal's scope on the client. Never use the current mailbox
as a substitute for a stamped target when the proposal has one.

### Executed state

After a successful user action:

1. update local card state immediately;
2. invalidate the relevant application query;
3. call `aiMarkProposalExecuted` if a conversation ID exists;
4. swallow bookkeeping failure;
5. leave failed operations editable/retryable.

Print is deliberately re-clickable because it is idempotent and requires a
fresh user gesture for popup blockers. Open-email is also navigable again.

### Starter chips

Starter chips fill the input and focus it; they do not send automatically.

The preference is a positional three-slot array:

- whitespace/empty means use the default;
- saving text equal to the default stores `""`;
- always save the full three-slot array;
- do not deduplicate slots;
- each custom value is capped at 200 characters by the preference registry.

Right-click opens the editor. Preserve the existing mobile limitation unless
you are explicitly changing the interaction model.

### Draft input

The unsent chat input is persisted per signed-in primary user. Do not use it
as a shared global value and do not let a user switch restore another user's
draft.

## Do not break these security boundaries

1. Do not trust model-supplied folder targets for delete/archive.
2. Do not trust model-supplied message identifiers unless they match a known
   shown message.
3. Do not trust model-supplied mailbox values; stamp sensitive proposal
   mailbox values server-side or validate them against owned accounts.
4. Do not let quoted email content inject fake action/tool blocks into visible
   prose or bypass grounding.
5. Extract machine blocks before stripping links.
6. Strip all blocks, but parse only the first complete action block.
7. Do not expose raw settings values that are not in the display-safe catalog.
8. Do not expose admin settings through personal settings tools.
9. Do not send FlashMail session tokens or upstream provider tokens in prompt
   content, attachment URLs, logs, or conversation rows.
10. Do not persist attachment bytes.
11. Do not use client consent as a substitute for authenticated server
    ownership checks.
12. Do not let account switching retarget an in-flight proposal or search.

## Extension recipes

### Adding a new read/search tool

1. Add a discriminated Zod tool schema in `ai.ts`.
2. Add it to `toolCallSchema`.
3. Decide whether execution belongs on the server or client:
   - use `serverSteps` only for data the server already owns and can scope
     safely without mailbox-route reimplementation;
   - use `toolRequest` when the existing authenticated client API must execute.
4. Add the completed step schema to `agentStepSchema` if the loop must
   continue.
5. Add the tool instructions in `buildAgentInstruction`.
6. Add the client execution branch if client-side.
7. Add prompt/result size caps.
8. Add route tests for valid, malformed, unauthorized, capability-disabled,
   and step-cap paths.
9. Add client tests for the re-post and stale-generation paths.

### Adding a new mutating tool

Use this pattern:

```text
model emits intent
  -> server validates and grounds it
  -> server mints opaque proposal
  -> client renders a confirm/edit card
  -> user confirms
  -> client calls the existing authenticated mutation
  -> client updates UI and invalidates queries
  -> client stamps executed state
```

Never let the model perform the mutation directly. For mail actions, ground
against known message rows. For settings/rules, validate against the relevant
catalog or live account state. For cross-account operations, stamp and pin
the target account.

### Adding a new card

Mirror an existing card's fields and lifecycle. Update all four whitelist
locations listed under “Terminal cards and persistence.” Add:

- live response rendering;
- history restore rendering;
- executed/dismissed state;
- account mismatch behavior;
- query invalidation;
- persistence route coverage; and
- client resume coverage.

If the card has a side effect, verify that history restore cannot trigger it.

### Adding a new AI feature route

Use:

```text
requireSession
  -> parse with Zod
  -> feature toggle gate
  -> resolve operation/provider config
  -> assemble shared guardrails + feature prompt
  -> apply input cap
  -> call provider
  -> validate/normalize provider output
  -> strip external links only from visible prose
  -> return structured JSON
```

Use `/api/ai/config` for UI policy. Do not invent a second provider key,
attachment cap, feature toggle, or prompt-config source.

## Testing requirements

Run the smallest relevant tests first, then the full relevant suite.

Important existing tests include:

```bash
# Webmail chat panel
pnpm --filter @workspace/webmail exec vitest run \
  src/components/mail/AIChatPanel.test.tsx

# API agent protocol and proposal grounding
cd artifacts/api-server
RUN_DB_INTEGRATION_TESTS=1 node --import tsx --test \
  src/__tests__/ai-agent-tools.route.test.ts

# Compaction behavior
cd artifacts/api-server
RUN_DB_INTEGRATION_TESTS=1 node --import tsx --test \
  src/__tests__/ai-context-compaction.route.test.ts

# Attachment validation/config
cd artifacts/api-server
RUN_DB_INTEGRATION_TESTS=1 node --import tsx --test-concurrency=1 --test \
  src/__tests__/admin-ai-attachment-config.route.test.ts \
  src/__tests__/ai-chat-attachments.route.test.ts
```

Also inspect nearby tests for:

- conversation history serialization;
- action-block stripping and grounding;
- folder access consent;
- server steps versus client tool requests;
- account mismatch;
- proposal executed stamping;
- stale generation after New chat, history resume, and Stop;
- attachment retries/resumes;
- calendar local-time conversion;
- rule and settings proposal validation; and
- prompt overflow retry.

If DB integration tests fail with missing tables, migrate the development
schema first:

```bash
pnpm --filter @workspace/db run migrate
```

## Final review checklist

Before finishing any AI chat change, verify:

- Is the change in the correct layer: prompt, API route, generated contract,
  client loop, or existing domain mutation?
- Does the server validate every model-controlled identifier?
- Does every write remain proposal/confirmation-gated?
- Are folders and mailboxes canonicalized and account-pinned?
- Are action anchors drawn from the exact context the model saw?
- Are attachments re-sent on every agent round and never persisted as bytes?
- Does the `serverSteps` branch run before `toolRequest`?
- Are generation checks present after every await and in catch?
- Do New chat, history restore, and Stop clear or invalidate the right state?
- Does a new card survive live response, history restore, GET serialization,
  and persistence?
- Does a feature honor global, admin-feature, personal-master, and
  per-feature gates?
- Did you update OpenAPI before generated clients/Zod output?
- Did you add or update route and panel tests?
- Did you run `git diff --check` and the relevant tests?

If the existing code and this document disagree, inspect the current code,
OpenAPI, and tests first. Preserve the observed behavior unless the requested
change explicitly changes the contract, and update this document when a
durable contract changes.
