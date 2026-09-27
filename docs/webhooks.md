# Webhooks, schedules, and due dates

How Boomerang delivers to a webhook destination, and how the scheduler decides when a
schedule or a due date fires. The code is `apps/server/src/workers/`.

## Destinations

A destination is a name and an http or https url in one project, created in Settings (or
`POST /api/v1/destinations`). Creating it returns a 32-byte secret as 64 hex characters,
shown exactly once; rotate it to get a new one. Urls that carry credentials
(`https://user:pass@host/...`) are refused, and names are unique among a project's live
destinations. Archiving a destination stops every pending delivery to it.

## Delivery

A rule action `emit_webhook` writes a row to the outbox in the same transaction as the chain
event that caused it. A worker takes due rows every 5 seconds and POSTs each one:

```
POST <destination url>
Content-Type: application/json
User-Agent: Boomerang
X-Boomerang-Delivery: <outbox row id>
X-Boomerang-Event: <chain event type, e.g. ticket.moved>
X-Boomerang-Signature: sha256=<hex>

{"id": "<outbox row id>", "event": "ticket.moved", "eventSeq": 412, "at": "2026-09-25T10:00:00.000Z", "payload": { ... }}
```

Any 2xx response marks the delivery done. Redirects are not followed.

### Verifying the signature

The signature is HMAC-SHA256 over the exact request body bytes. The key is the secret as it
was shown to you: the 64-character hex string itself, as UTF-8 bytes, not the 32 bytes it
encodes. In Node:

```js
import { createHmac, timingSafeEqual } from "node:crypto";
const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
const ok = timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers["x-boomerang-signature"]));
```

Compare against the raw body, before any JSON parsing or re-serialisation. After a rotate,
deliveries queued from then on are signed with the new secret; a delivery already in flight
was signed with the secret in force when it was sent.

### Retries

A failed attempt (no 2xx, a connection error, a timeout) is retried after 30 seconds, then
2 minutes, 10 minutes, 1 hour, and 6 hours between each later attempt, eight attempts in all
(about a day). After the eighth failure the row is kept for the record but never retried, a
`webhook.failed` chain event is appended, and the ticket named by `payload.ticketId`, if any,
is flagged `needs_human`. Delivered rows are removed after seven days.

One attempt has a hard deadline of 20 seconds covering name resolution, the connection, and
the response body, and a 10 second socket idle timeout inside it, so one slow destination
cannot hold up the rest of the queue.

### Where deliveries may go

Only http and https. The destination's name is resolved at send time and the connection is
pinned to that address; loopback, private (10/8, 172.16/12, 192.168/16), link-local
(169.254/16), carrier-grade NAT (100.64/10), multicast and reserved ranges, and their IPv6
equivalents (including IPv4-mapped and IPv4-compatible spellings) are refused. Set
`BOOMERANG_ALLOW_PRIVATE_WEBHOOKS=1` on the server to allow them, for example to deliver to
a service on the same machine.

## Schedules

A rule whose When node is a Schedule carries a cron expression (five fields; six with
seconds), an IANA timezone, and a missed policy. The scheduler checks every 15 seconds for
schedules whose next run has come and fires each as the chain event
`trigger.fired {ruleId, triggerId, projectId, scheduledFor, missed}`, which the rule's
conditions and actions then see like any other event.

Nothing fires while the database is locked. On unlock, and on start when encryption is
off, runs that fell in the gap (anything more than a minute old) go by the rule's missed
policy:

- `skip`: they are dropped; only a run due right now fires.
- `run_once` (the default): one fire stands for all of them, `scheduledFor` being the
  latest, `missed` the number folded in.
- `run_all`: one fire per missed run, newest 100 at most; the rest are dropped with a note in
  the server log.

## Due dates

A ticket's due date is a calendar day. It has passed once that day has ended in the
timezone the server process runs in (its local midnight), and the scheduler then appends
`ticket.due_passed {ticketId, projectId, dueDate}` once for that ticket and that date. A due
date moved to a later day that then passes is announced again. If your server runs in UTC
and your team does not, a due date passes at UTC midnight, not yours.
