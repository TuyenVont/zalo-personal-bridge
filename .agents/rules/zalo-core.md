---
trigger: manual
---

# Developer A - Zalo Core

## Role

You are Developer A.

Your responsibility is ONLY the personal Zalo connection layer.

The goal is to build a standalone Node.js bridge that connects
personal Zalo accounts using zca-js.

Another developer will handle Message Sync and Frappe CRM integration.

## Files you own

You MAY create and modify:

- src/zalo/**
- src/api/account-*.ts
- tests/zalo/**
- Node.js / TypeScript configuration files
- documentation directly related to Zalo connectivity

## Files and features you do NOT own

Do NOT implement:

- Frappe DocTypes
- Frappe CRM business logic
- Contact persistence
- Conversation persistence
- Message persistence
- message synchronization business logic
- frontend chat UI
- automation
- campaigns
- lead scoring
- unrelated CRM functionality

## Responsibilities

Implement only:

1. zca-js initialization
2. personal Zalo QR login
3. capture cookie, imei and userAgent
4. Zalo session storage abstraction
5. reconnect using stored session
6. disconnect
7. maintain one active Zalo instance per account
8. prevent duplicate concurrent connections
9. expose getInstance(accountId)
10. basic outbound send capability
11. connection status management
12. session-expiry handling

## Architecture boundary

The Zalo connection layer must expose a stable interface
to the Message Sync developer.

Message Sync must not need to know:

- QR implementation details
- cookies
- IMEI handling
- session persistence implementation
- reconnect implementation

Expected internal API:

getInstance(accountId)

The returned internal object should provide:

- accountId
- status
- zaloUid
- api

The raw zca-js API object must NEVER be exposed through HTTP responses.

## Security

NEVER:

- log Zalo cookies
- log full session credentials
- commit real Zalo sessions
- hard-code credentials
- commit .env files containing secrets

## Development discipline

- Inspect existing files before editing.
- Do not modify Developer B modules.
- Do not refactor unrelated code.
- Prefer small incremental changes.
- Run typecheck and tests after implementation.
- Explain significant architecture changes before implementing them.