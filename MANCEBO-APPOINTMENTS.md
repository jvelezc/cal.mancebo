# Mancebo.ai appointment service

## Use it

Open https://mancebo.ai/appointments, or choose Tools → Your appointments. Sign in to Mancebo if asked. The owned scheduling UI runs at https://appointments.mancebo.ai and reuses that first-party session. A separate native password, Mancebo API key or identity federation is not customer setup. Attendees use public booking links without signing in.

Your personal appointment profile follows your verified Mancebo user UUID, not the currently selected business. Calendar authorization, email delivery and customer API/MCP/Hermes scheduling have separate setup and acceptance gates; do not assume they are enabled by a successful browser sign-in.

## Identity and deployment

The native Next.js server verifies the existing Mancebo user and authoritative actor context directly. `manceboUserId` is unique; a matching email never links a legacy profile automatically. The legacy owner is linked by an explicitly verified operator operation. New profiles are ordinary users without automatic team/admin grants. Native passwords, signup and password-reset mutations are disabled in the Mancebo build. The first-party frame checks exact origins, actual parent/frame windows, expiry, sign-out and account changes. Access tokens are not placed in URLs, local storage, documentation or browser-visible session responses. The scheduler never receives a Mancebo refresh token.

Production uses the existing Contabo host `vmi3547385` (`89.117.17.81`), Ubuntu 24.04 and rootful Podman. It owns dedicated web/API containers, PostgreSQL, Redis and data volumes. Release images are pinned by digest and source revision in `us-central1-docker.pkg.dev/gbmigration-7d3cb/mancebo-scheduling`. `NEXT_PUBLIC_MANCEBO_AUTH_ENABLED=true` qualifies the web build; `MANCEBO_AUTH_ENABLED=true` also activates protected server runtime configuration. Do not disable central authentication to work around an error.

Privileged secrets remain in Google Secret Manager project `gbmigration-7d3cb`. `ManceboContaboOperatorSshIdentity` is restricted SSH recovery. `ManceboSchedulingAdministratorCredential` is legacy operator recovery, not normal customer sign-in. Native session encryption, database and provider credentials are not distributed to customers.

Authoritative operator instructions, current deployment evidence, exact access, architecture, encrypted backup/restore and health alerts are maintained in the Mancebo repository:

- [Access directory](https://github.com/jvelezc/mancebo/blob/main/docs/ACCESS-GUIDE.md)
- [Scheduling architecture](https://github.com/jvelezc/mancebo/blob/main/docs/SCHEDULING-ARCHITECTURE.md)
- [Scheduling operations](https://github.com/jvelezc/mancebo/blob/main/docs/SCHEDULING-OPERATIONS.md)

## Qualification

The dedicated image workflow performs immutable dependency installation, focused identity/session/copy/mutation-boundary tests, forced type-check and web/API builds. It publishes through a short-lived repository-bound Google workload identity. Source CI is not live browser acceptance: record the immutable images, owned app replacement, owner mapping, retained data IDs, authenticated customer/admin journeys and anonymous booking checks in the operator runbook before declaring release completion. Keep shared Podman and unrelated agents running.
