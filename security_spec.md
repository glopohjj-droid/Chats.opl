# Security Specification: Global General Chat

This document outlines the security architecture, invariants, and adversarial "Dirty Dozen" payload test suite to satisfy Attribute-Based Access Control (ABAC) for our real-time persistent chat application.

## 1. Data Invariants

1. **Immutable Messages**: A sent message can never be updated or deleted by anyone to protect the historical integrity of the public chat.
2. **Creator Validation**: Standard user messages must have a `userId` matching their authenticated Google UID.
3. **AI Persona Protection**: Only messages sent with `userId == "ai-assistant"` are allowed to set `isAi` to `true`. Standard users cannot forge AI messages under their own UID.
4. **Verified Emails**: All writes to `messages` and `users` require `request.auth.token.email_verified == true`.
5. **Exact Schema Structure**: Message payloads must have exactly between 5 and 8 properties to prevent shadow/extra fields.
6. **Temporal Sincerity**: Both the message's `createdAt` and user's `createdAt`/`updatedAt` must sync with the server's `request.time`.

---

## 2. The "Dirty Dozen" Payloads (Adversarial Security Test-Cases)

The following malicious payloads must be rejected by `firestore.rules`:

1. **The Ghost Field Attack**: Inserting an unallowed property (`ghostField: true`) into a message document.
2. **The Spoofed Author Attack**: User `alice` tries to write a message with `userId: "bob"`.
3. **The Spoofed AI Persona Attack**: User `alice` tries to write a message with `userId: "alice"` and `isAi: true`.
4. **The False Email Verification Attack**: Creating a user profile or message without verified email status (`email_verified == false`).
5. **The Temporal Anachronism (Alice)**: Creating a message with a spoofed historic/future `createdAt` timestamp.
6. **The Shadow Update Attack**: Attempting to update an existing message document with new text.
7. **The Arbitrary Deletion Attack**: Attempting to delete a message document.
8. **The ID Poisoning Attack**: Trying to write a message with a 2MB system key string as the `messageId`.
9. **The Profile Hijack Attack**: User `alice` tries to rewrite `bob`'s user profile document under `/users/bob`.
10. **The Registration Time Spoof**: User `alice` registers her profile but manual-claims she has been registered since 2010 (`createdAt` doesn't match `request.time`).
11. **The PII Overwrite Hack**: Updating an immutable field (`uid` or `createdAt`) in `/users/alice`.
12. **The Unauthenticated Write Attack**: Standard post request sent without any active session token.

---

## 3. Recommended Test Suite Runner

A corresponding `firestore.rules.test.ts` or local emulator script validates that all adversarial payloads above result in a `Permission Denied` error.
