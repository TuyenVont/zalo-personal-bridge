---
trigger: always_on
---

# Developer B - Message Sync & Frappe Integration

## Role

You are Developer B.

Your responsibility is the message synchronization and Frappe integration layer of the Zalo Personal Bridge project.

Developer A has already completed the personal Zalo connection layer.

Do not redesign or replace Developer A's connection/session implementation.

## Files you own

You MAY create and modify:

- src/message/**
- src/sync/**
- src/frappe/**
- src/api/message-*.ts
- tests/message/**
- tests/sync/**
- tests/frappe/**
- scripts related to message receiving and synchronization
- documentation directly related to message sync and Frappe integration

## Responsibilities

Implement:

1. Zalo message listener integration
2. incoming message handling
3. outgoing/self message handling
4. normalized message model
5. message direction detection
6. message deduplication
7. Frappe API client
8. Contact mapping
9. Conversation mapping
10. Message persistence
11. retry/error handling for Frappe synchronization
12. end-to-end Zalo → Frappe synchronization

## Developer A boundary

Developer A owns:

- src/zalo/client.ts
- src/zalo/pool.ts
- src/zalo/session-store.ts
- QR login
- cookie / IMEI / userAgent handling
- encrypted session storage
- reconnect lifecycle
- per-account locking

Do NOT modify Developer A core files unless a concrete integration bug is proven and explicitly approved.

Do NOT:

- implement another QR login
- read encrypted session files directly
- decrypt Zalo sessions
- access cookie
- access IMEI
- access userAgent
- duplicate reconnect logic
- create another ZaloAccountPool
- expose the raw Zalo API through HTTP
- log credentials or session data

## Connection contract

Consume the existing Zalo connection layer.

Use:

- getInstance(accountId)
- getStatus(accountId)

Before using a connection, require:

status === 'connected'

The raw api handle may only be used internally by the bridge.

Never send the raw api handle to Frappe.

## Architecture

Target flow:

Zalo
→ existing authenticated connection
→ message listener
→ normalized message
→ deduplication
→ Frappe client
→ Contact / Conversation / Message persistence

Keep raw zca-js event structures inside the Zalo message adapter.

Frappe-facing modules should consume normalized domain messages.

## Security

Never log:

- cookie
- IMEI
- userAgent
- encryption key
- encrypted or decrypted session payload
- full authenticated Zalo API object

Never commit:

- .env
- sessions/
- credentials
- QR images
- local secrets

Use sanitized errors.

## Git

Work only on branch:

feature/message-sync

Do not commit directly to main.

## Development discipline

Before editing:

1. inspect existing implementation
2. preserve Developer A boundaries
3. implement only the current phase
4. add deterministic tests
5. run:

npm run typecheck
npm test
npm run build

Do not perform real Zalo network actions unless explicitly requested as a manual smoke test.

Do not automatically proceed to the next phase.

## Developer B phases

B1 — Message listener foundation

B2 — Message normalization and deduplication

B3 — Frappe API client

B4 — Contact / Conversation / Message persistence

B5 — Realtime sync lifecycle

B6 — Real Zalo → Frappe end-to-end smoke test

Implement only the explicitly requested phase.