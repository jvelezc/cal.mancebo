# Appointment connection ownership

One shared scheduling deployment can serve many customers. Its application code,
provider catalog and infrastructure are shared. A connection to a customer's
calendar, conferencing or payment account is a separate owned database record.
The “Install” action connects an integration; it does not install arbitrary
customer code or start another server instance.

## Current behavior

| Operation | Authority and scope |
| --- | --- |
| Enable a provider or configure its application credentials | Native platform administrator; affects the shared instance |
| Connect a personal Google Calendar account | Signed-in scheduling user; callback stores that user's credential |
| List personal connected apps | Current user's credentials |
| List team connections | Accepted native scheduling team membership |
| Disconnect a personal integration | Current user's credential with no team owner |
| Disconnect a team integration | Current accepted native team administrator or owner |

Provider application credentials and customer OAuth tokens are different secrets.
Customers must not receive the platform's OAuth client secret, shared mail
transport credential or another customer's tokens.

The personal appointment profile is linked to the immutable Mancebo user identity.
It is **not a separate profile for every Mancebo workspace**. A person belonging
to multiple Mancebo businesses still has the same personal scheduling profile.
Selecting another business in Mancebo must not be presented as switching that
person's underlying connected calendar.

Native scheduling teams have not yet been qualified as Mancebo workspaces. A
native team ID, email domain or browser-selected business is not proof of Mancebo
workspace authorization. Business-level organizer mapping and customer
API/MCP/Hermes scheduling remain tracked in Mancebo issue #539. Personal sign-in
and connection ownership do not prove those integrations are complete.

## Customer and administrator navigation

Customer wording should distinguish **My connections** from **Workspace
connections**. Until workspace mapping is implemented and qualified, show the
personal scope explicitly. Reserve **Available integrations** and provider
configuration for platform administration. Workspace administrators must never
be promoted to native platform administrators to configure their own connection.

Appointment confirmation mail is a first-party service. Its platform defaults
and workspace wording overrides are independent of installing a messaging app.
Do not tell customers to install a third-party messaging integration to receive
an ordinary booking confirmation.

## Required workspace release gates

1. Persist an immutable Mancebo workspace-to-organizer/team association; authorize
   it using current Mancebo membership and service grants on the server.
2. Bind connection initiation, callback, listing, use and removal to that verified
   workspace. Do not fall back to the platform administrator's calendar.
3. Test two unrelated workspaces, a person belonging to both, ordinary versus
   administrator roles, revoked membership and disconnected providers. Verify
   direct requests as well as the UI.
4. Keep global provider settings separate from workspace connections; record
   actor, scope, operation and outcome without logging tokens or message content.
5. Document which account owns each connection before enabling assistant booking.

## Disconnect regression evidence

`packages/features/credentials/handleDeleteCredential.ownership.test.ts` exercises
the real removal handler with synthetic database boundaries. It checks denial
before reading foreign connections, personal versus team ownership, accepted
administrator membership, managed-event cleanup and exact connection IDs for
calendar cleanup. These are targeted regressions, not a complete audit of every
upstream integration or a live cross-workspace OAuth qualification.
