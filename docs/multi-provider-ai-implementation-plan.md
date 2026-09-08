# Multi-provider AI implementation plan

Status: planning only. No application implementation is included.
Prepared against the SummerMail checkout on September 8, 2026.

## 1. Outcome and scope

Make every existing AI feature use a selected provider: OpenAI, Google Gemini, Anthropic Claude, DeepSeek, or a custom OpenAI-compatible endpoint. A user can save each provider's credentials and model independently, switch providers, and continue using chat, mailbox questions, proposal cards, thread summaries, quoted-history summaries, and composer writing checks.

Use one active provider/model for all features in the first implementation. Separate models per feature, automatic provider fallback, model routing, streaming, OAuth, Google Vertex AI, Azure-specific authentication, and PDF/audio/video support are deferred. “Custom” means an endpoint implementing the supported Chat Completions contract; it does not promise compatibility with every proprietary API.

Preserve existing OpenAI installations, mailbox access restrictions, privacy options, local conversation history, action review, cancellation, and summary storage. Do not change mail synchronization, calendar execution, Teams authentication, native mailsync, packaging, icons, or unrelated work already in the checkout.

## 2. Actual starting point

Paths below are repository-relative to `D:\Codex\MailClient`.

| Existing file | Relevant responsibility |
| --- | --- |
| `app/internal_packages/message-list/lib/openai-mail-assistant-client.ts` | Hardcoded HTTPS request to `api.openai.com/v1/responses`; text summaries; tool definitions; six-round mailbox tool loop; proposal grounding; image/text attachment encoding |
| `app/internal_packages/message-list/lib/preferences-mail-assistant.tsx` | KeyManager credential access, environment precedence, model config constants, settings UI |
| `app/src/config-schema.ts` | `core.mailAssistant` defaults, including model `gpt-5.6-terra` |
| `app/internal_packages/message-list/lib/mail-assistant.tsx` | Chat submission, cancellation/retry, attachments, context/privacy preparation, reviewed proposal actions |
| `app/internal_packages/message-list/lib/ai-summary-client.ts` | Thread/quote transcript preparation and summary requests |
| `app/internal_packages/message-list/lib/thread-summary.tsx` | Thread-summary credentials, generation, restore, persistence |
| `app/internal_packages/message-list/lib/quoted-text-summary.tsx` | Quote-summary credentials, caching, generation, insertion |
| `app/internal_packages/message-list/lib/ai-summary-store.ts` | SQLite cache scoped to user/mailbox/thread or quote hash; currently no provider/model provenance |
| `app/internal_packages/composer/lib/composer-ai-actions.tsx` | Writing-check requests using the summary function |
| `app/internal_packages/message-list/lib/mail-assistant-session-store.ts` | Local chat history; imports shared types from the OpenAI client |
| `app/internal_packages/message-list/lib/mcp-mail-assistant-client.ts` | Existing local mailbox read boundary and account restrictions |
| `app/internal_packages/message-list/specs/*mail-assistant*` | Credential, privacy, and contract regression tests |
| `deployment/windows/README.txt` | Existing managed OpenAI credential instructions |

Important: `docs/ai-chat-agent-prompt.md` describes FlashMail web/API files and a different architecture. Its provider/PDF statements are not evidence that this desktop client already implements those features. Use the actual desktop source as the implementation baseline. Do not introduce the FlashMail Express/PostgreSQL architecture here.

## 3. Architecture and file boundaries

Keep the existing direct Node HTTP transport approach inside Electron; no new agent framework or provider SDK is required for this scope. Inject the transport for tests. Keep provider code free of React, mailbox access, and action execution.

Create focused files under `app/internal_packages/message-list/lib/`:

| Proposed file | Responsibility |
| --- | --- |
| `ai-provider-types.ts` | Neutral requests, results, content, tool schemas, capability and error types |
| `ai-provider-registry.ts` | Provider labels, protocol adapter selection, fixed endpoints, environment names and model capability presets |
| `ai-provider-settings.ts` | Config constants, credential resolution/save/remove, legacy compatibility, settings-change notifications |
| `ai-http-client.ts` | Bounded JSON transport, timeout, abort, status/error normalization |
| `ai-providers/openai-responses.ts` | Existing Responses protocol isolated into an adapter |
| `ai-providers/openai-compatible.ts` | Chat Completions protocol for custom endpoints and reusable DeepSeek behavior |
| `ai-providers/anthropic.ts` | Native Messages protocol |
| `ai-providers/google.ts` | Native Gemini generateContent protocol |
| `ai-providers/deepseek.ts` | Small explicit preset/wrapper for DeepSeek-specific continuation and capability handling |
| `mail-assistant-tools.ts` | Shared tool definitions, argument validation and existing grounding helpers |
| `mail-assistant-client.ts` | Provider-neutral summary entry point and shared assistant orchestration |

Preserve the public `AssistantResponse` shape (`text`, reviewed `toolCalls`) so proposal rendering/execution needs minimal change. Move public chat/attachment types out of the OpenAI-named module. Update all imports; a temporary re-export shim is acceptable during staged work, but shared callers must finish on neutral imports.

Suggested adapter contract (a design sketch, not required exact syntax):

```ts
interface AIProviderAdapter {
  createExchange(config: ResolvedAIConfig, request: AIRequest): AIExchange;
}

interface AIExchange {
  next(results?: AIToolResult[], signal?: AbortSignal): Promise<AITurn>;
}

interface AITurn {
  text: string;
  toolCalls: Array<{ id: string; name: string; arguments: unknown }>;
  finish: 'complete' | 'tool-calls' | 'length' | 'blocked';
}
```

`AIRequest` contains system instructions, bounded user/assistant history, normalized text/image content, optional tool definitions and an output budget. `ResolvedAIConfig` is an immutable snapshot of provider, endpoint, model, capabilities and resolved credentials for one operation. Never resolve credentials again between tool rounds.

Each exchange privately retains its complete provider-native response and appends matching tool results. This avoids flattening away continuation fields. Native state is memory-only, scoped to one submitted operation, and never passed to another provider, logged, or stored with chat history. The orchestrator sees normalized text and calls only. Do not use module-global conversation state.

## 4. Provider behavior

### OpenAI

Keep `/v1/responses`, bearer authentication, `instructions`, `input`, existing `store: false`, and summary output budgeting. Normalize output text and function calls, and preserve native response items when continuing with `function_call_output`. Do not accidentally migrate existing OpenAI users to Chat Completions. The official [function-calling guide](https://developers.openai.com/api/docs/guides/function-calling) describes the response/call-result continuation contract.

### Anthropic

Use `https://api.anthropic.com/v1/messages` with `x-api-key` and the documented `anthropic-version` header. Supply top-level system instructions and a required output-token limit. Map schemas to `input_schema`, responses to text/`tool_use`, and results to user `tool_result` blocks with matching IDs. Preserve block ordering and return all results for parallel calls together. See [Anthropic tool-result handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls). Start without optional extended-thinking controls; preserve any required native continuation blocks rather than displaying them.

### Google Gemini

Use the native generateContent endpoint, `x-goog-api-key`, `systemInstruction`, `contents` with user/model roles, function declarations, and function responses. Map text/image content to the documented parts. Preserve full returned model parts, including thought signatures, in the exchange. Keep call/result associations stable, including parallel calls to the same function; synthesize local IDs only where native IDs are absent. See [Gemini function calling](https://ai.google.dev/gemini-api/docs/generate-content/function-calling?authuser=0&hl=en) and [thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures). The retrieved docs label this API as legacy; verify its supported status and chosen model at implementation time. Do not silently switch to a different protocol without updating the adapter fixtures.

### DeepSeek and Custom

Implement Chat Completions: system/user/assistant messages, nested function tools, assistant `tool_calls`, and `role: tool` results correlated by `tool_call_id`. DeepSeek's official [API introduction](https://api-docs.deepseek.com/) documents OpenAI compatibility; use its configured official base URL, not OpenAI's hostname. Preserve `reasoning_content` in applicable DeepSeek continuations, following its [thinking-mode contract](https://api-docs.deepseek.com/guides/thinking_mode/). Keep it internal and out of visible assistant text.

Custom accepts an explicit base URL, model ID, optional dedicated key, and declared tool/image capabilities. Append `/chat/completions` exactly once while preserving configured path prefixes such as `/v1`. Never infer protocol or credentials from a model-name prefix. A new OpenAI-compatible service should need configuration; a genuinely different protocol should need only a new adapter and registry entry.

### Capability policy

Text generation is the common baseline. Tool calls and images depend on the selected model and endpoint, not just vendor. Maintain a small documented capability preset list and permit manual model IDs. Do not hardcode unverified new model defaults or silently replace the existing OpenAI model. Require a model selection for a new provider if there is no verified default.

For unknown/custom models, expose explicit advanced tool/image capability settings with conservative defaults. Plain chat, summaries and writing checks remain available for text-only models. Disable mailbox/tool features and image input with a clear explanation when unsupported; never silently drop tools or attachments and pretend the operation succeeded. Do not silently retry through another provider or downgrade a mailbox question to ungrounded text.

Translate the shared schema subset explicitly: object, required fields, arrays, enums, limits and nullable values. Handle provider differences in nullable declarations and strict-mode support in adapters. Keep local argument validation authoritative even when a remote provider accepts strict schemas.

## 5. Settings, credentials, and migration

Add `core.mailAssistant.provider` (default `openai`) and per-provider nonsecret settings under `core.mailAssistant.providers`: model, custom base URL/auth mode, and relevant capability overrides. Preserve all existing privacy/context/summary settings globally.

Credential rules:

1. Continue using `openai-mail-assistant-api-key` for OpenAI. This preserves upgrades and rollback without copying or deleting the old key.
2. Give other providers separate KeyManager entries, e.g. `google-mail-assistant-api-key`, `anthropic-mail-assistant-api-key`, `deepseek-mail-assistant-api-key`, and an endpoint-scoped custom entry.
3. Resolve only the selected provider's environment variables before its saved key. Preserve `MSSE_OPENAI_API_KEY` then `OPENAI_API_KEY`; propose equivalent `MSSE_ANTHROPIC_API_KEY`/`ANTHROPIC_API_KEY`, `MSSE_DEEPSEEK_API_KEY`/`DEEPSEEK_API_KEY`, and `MSSE_GEMINI_API_KEY`/`GEMINI_API_KEY`/`GOOGLE_API_KEY`. Document these names as application choices, including Gemini precedence.
4. Custom must never inherit `OPENAI_API_KEY`. Scope its saved key to the normalized endpoint so changing hosts cannot silently reuse a secret. Clear an unsaved key when the endpoint/provider changes. Support explicit no-auth mode for local services.
5. With no new OpenAI model setting, read legacy `core.mailAssistant.model`; save it alongside the new OpenAI setting for rollback. Never use that legacy value as another provider's model.
6. Do not let schema defaults mask whether a per-provider model has actually been saved. Make migration idempotent and preserve user overrides.
7. Never store keys in AppEnv config, localStorage, SQLite, chat state, diagnostic output, or fixtures. Clear password input after save; loading a provider reports saved/managed status without displaying its secret.

Move settings/credential logic out of the React component. Shared clients and composer should not import a settings view to retrieve configuration. Expose readiness as configuration validity, not `!!apiKey`, because an explicitly configured local custom endpoint may be keyless.

## 6. Settings and runtime UX

Preserve the current settings visual style and Teams section. The job is to choose and configure the AI service used by the existing mail tools.

Order controls: Provider selector → provider-specific credential/managed status → Model → Custom endpoint and advanced capabilities when applicable → Test connection → existing privacy/context/summary options → Save/remove-key actions.

Provider switching in the form edits a draft until Save. Maintain saved models/keys independently; discard unsaved password text on switch. Disable repeated saves/tests during their operation. Guard asynchronous credential checks with a selection revision so an older provider's lookup cannot overwrite the current form.

“Test connection” uses the draft configuration and a short synthetic prompt containing no mail. It does not save the form. Report provider/model, authentication/model/endpoint errors, and only capabilities actually tested. A successful text test does not establish image/tool compatibility. Testing may consume a small API charge; say this beside the button.

Replace OpenAI-only labels/errors/privacy copy in settings, chat, summaries, and composer with provider-aware wording. Show the active provider/model in chat. For a provider/model switch, start a fresh outgoing chat while keeping the previous local conversation accessible, preventing automatic transmission of old conversation content to a new service.

Observe applied settings changes in mounted AI surfaces. Abort/invalidate active work on provider/model/endpoint/privacy changes. Check a request revision before appending chat results, saving summaries, or inserting composer text. Unsubscribe observers on unmount. A stale completion must not update a different thread, quote, draft, or provider selection.

## 7. Shared tool loop and privacy invariants

Extract the existing loop; do not implement one mailbox agent per provider.

- Preserve the last-20-turn and per-turn 8,000-character limits; preserve six model-call rounds, search limit 30, list limit 25 and tool-output limit 60,000 characters. Bound aggregate calls per response as well (proposed maximum 16) to avoid unbounded parallel reads.
- Read tools continue through `callMailboxReadTool` with focused-account/default-account rules and MCP permissions. Providers never receive MCP credentials or direct mailbox execution access.
- Validate every tool name and argument object locally. Malformed JSON, unknown names, excessive arrays, and wrong types become controlled tool errors. Never crash the whole conversation on `JSON.parse` or execute unknown tools.
- Gather grounding from authorized read results before redacting the model-visible result, retaining existing alias behavior and email links.
- Keep move/read/trash grounding and review cards. Draft/calendar tools remain proposals; no adapter executes actions or sends email.
- Handle mixed read/proposal responses explicitly: if a response has reads, complete those reads, acknowledge proposal calls as deferred/not executed, and instruct the next round to reissue any final proposal after reviewing results. Only terminal proposals become cards. Every call in continued native history must get a correlated result; no unmatched calls or fabricated success.
- At the round limit, stop without executing another batch of reads. Return a controlled limit outcome and no incomplete proposal cards. Distinguish blocked, empty and token-truncated results; do not accept truncated tool JSON as a valid action.
- Preserve caller-side redaction and extend the same applicable text filtering to attached text and filenames before provider encoding. Images cannot be reliably redacted by text replacement; explain this when attaching images with filtering enabled.
- Keep existing file count/size/type constraints (including 5 MB per file and 15 MB aggregate) and revalidate in the shared client, including retry paths. This phase adds no PDF support.

## 8. Transport and failure behavior

Use a shared HTTP helper with provider-owned headers and payloads. Fixed providers use their fixed official origins. Custom requires HTTPS except explicitly configured loopback HTTP (`localhost`, `127.0.0.1`, `::1`) for local models. Reject URL credentials, fragments, query-string keys and unsupported schemes. Do not follow redirects with credentials; surface the configuration error. Do not disable TLS verification.

Keep the existing 60-second inactivity timeout and add a bounded total operation deadline (proposed 180 seconds across rounds), with abort listener cleanup and bounded response bytes (proposed 10 MB). Handle response-stream errors and early close as failures. A pre-aborted signal must not send a request.

Normalize errors for missing configuration, authentication, inaccessible model, unsupported feature, rate limiting, timeout, malformed response, service failure, cancellation and blocked output. Include safe provider/status context; sanitize provider error text because remote bodies may echo prompts or keys. Do not log raw response bodies. Keep explicit user retry; no automatic retries/fallback in this phase that could duplicate cost or change data recipients.

## 9. Summary cache and conversation persistence

Do not wipe existing chat or summary data. Move session-store type imports only; native provider continuation state stays out of persistence.

Add nullable generation metadata to both summary tables through an idempotent additive migration: provider, model, and a nonsecret generation fingerprint. The fingerprint includes provider, normalized endpoint identity, model, privacy/context inputs, input cap, and prompt version; never keys. Retain user/mailbox isolation and current uniqueness constraints.

Legacy or mismatched summaries remain available for display as previously generated results. They are not a valid cache hit for a new Generate/Refresh operation under another fingerprint. Regeneration replaces the existing row only after success. A settings switch alone must not trigger billable summary regeneration. For quoted summaries, do not automatically insert a mismatched cached result as if freshly generated. Tests must cover migration, failed regeneration preserving old results, and stale requests not writing after a settings change.

## 10. Ordered implementation work packages

Complete and verify each package before proceeding. Do not stop after merely adding the provider dropdown.

1. **Baseline and extraction:** inspect current diff; run existing relevant tests; introduce shared types, tools and injectable transport; extract the OpenAI adapter without changing behavior. Keep all contract/privacy tests passing.
2. **Configuration:** add registry/settings module and schema; implement legacy OpenAI reads, isolated keys, managed precedence, custom endpoint validation and readiness. Add configuration/migration tests.
3. **Other adapters:** implement Chat Completions/DeepSeek, then Anthropic, then Google. Add fixture-driven text and two-round tool tests for each before UI wiring. Verify model IDs/capabilities from official docs instead of inventing defaults.
4. **Shared orchestration:** connect neutral adapters to summary/chat entry points; implement complete tool-result correlation, validation, mixed calls, limits and unsupported-feature behavior. Preserve action review and grounding.
5. **Caller integration:** update chat, both summary components/client, composer writing checks and session imports. Remove direct credential/model fallback logic from callers. Add settings observation, cancellation and stale-result guards.
6. **Settings UI:** provider-specific form, test connection, custom mode, active-provider wording, capability-aware attachments and fresh chat on provider switch. Preserve unrelated sections and keyboard/localization conventions.
7. **Persistence and documentation:** add summary provenance migration; update deployment credential guidance and write concise custom endpoint/provider setup instructions. Search remaining OpenAI references and retain only intentional adapter/legacy/documentation mentions.
8. **Validation and handoff:** complete the matrix below, report exact checks and any unavailable live-provider coverage. Do not package, release, commit or publish unless separately requested.

## 11. Verification matrix and completion criteria

Automated tests should use fake keys, synthetic mail and mocked transport. Follow the repository's existing Jasmine APIs rather than assuming a modern Jest runner.

| Area | Required cases |
| --- | --- |
| Adapter contract, all five choices | Text-only answer; summary without tools; system prompt mapping; multiple calls; two-round continuation; ID matching; malformed/error/empty/blocked/length output |
| Provider-specific | OpenAI `store: false`; Anthropic parallel result ordering; Gemini signature/part preservation and repeated function names; DeepSeek reasoning-content preservation; custom `/v1` prefix and no OpenAI key inheritance |
| Tools | Account scoping; unknown tools; invalid arguments; grounded proposals; mixed reads/actions; no automatic writes; bounded calls and rounds |
| Transport | Authentication statuses; 429; 5xx; non-JSON; oversized body; timeout; pre-abort/mid-flight abort; no redirect credential forwarding |
| Settings | Legacy model/key; managed precedence; independent provider values; key removal; rapid provider switches; custom no-auth; endpoint change never reuses another endpoint's key |
| Privacy and attachments | Existing redaction tests; attached-text filtering; unsupported images rejected; size limits on retry; no secrets/native reasoning in stored history or errors |
| Application consumers | Chat, thread summary, quoted summary/insertion and writing checks all resolve the active provider; settings changes update readiness without restart |
| Persistence/races | Existing database migration twice; legacy cache preserved; mismatched provenance regenerates only on request; old completions cannot write/insert after scope or provider changes |

Run `npm run typecheck`, ESLint without `--fix` on changed TypeScript files, and the repository Electron/Jasmine suite (`npm test`, or its verified focused-spec mechanism). Root `npm run lint` modifies files; do not use it as a read-only validation command. If baseline failures exist, record them separately and demonstrate no new failures. Discover the runner's filtering syntax from the repository before claiming a focused command works.

Perform one bounded UI verification pass covering settings, missing key, saved/managed key, provider switch, invalid model, cancellation and disabled attachments. Where credentials are available, explicitly run a synthetic text and tool round trip for each named provider and a local/mock compatible endpoint. Missing credentials mean live verification is unperformed, not that the provider is verified. Do not send real mailbox content just to test connectivity.

Done means: all five configuration choices exist; all four AI surfaces use the selected provider; supported tool-capable models retain mailbox reads and reviewed actions; unsupported capabilities are explicit; existing OpenAI setup continues working; credentials stay isolated; automated checks pass or documented baseline failures are separated; live test coverage is honestly reported.

## 12. Prompt to hand to the implementing model

> Implement `docs/multi-provider-ai-implementation-plan.md` in this SummerMail repository. Follow its ordered work packages and use actual desktop source as truth. Preserve unrelated working-tree changes. Implement OpenAI, Google Gemini, Anthropic, DeepSeek and Custom OpenAI-compatible support across chat, thread/quote summaries and writing checks. Preserve credential isolation, privacy, mailbox scoping and reviewed actions. Keep provider-native continuation state in adapters and use one shared tool loop. Verify official model/protocol details where required, add the specified meaningful fixture/contract tests, run typecheck and relevant tests, and report untested live-provider coverage accurately. Do not release or publish.
