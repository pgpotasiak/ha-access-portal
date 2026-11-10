# Home Assistant temporary access portal

*[Polska wersja](README.pl.md)*

A small Cloudflare Worker that lets Home Assistant owners send guests a link and a PIN to control chosen entities, or see their state, for a limited time. Home Assistant is never exposed to the internet: it opens a WebSocket to the portal, and the portal only relays guest clicks. One portal serves many homes; new homes join with one-time invite codes from the administrator.

Home Assistant integration: [ha-access-integration](https://github.com/pgpotasiak/ha-access-integration). MIT licence.

Runs on the free Workers plan: a home uses a few hundred requests a day thanks to the hibernating WebSocket.

## Deploying your own portal (no local tools needed)

1. Fork or copy this repository to your GitHub account.
2. In Cloudflare create a D1 database (*Storage & databases → D1 → Create*) and put its ID into `wrangler.jsonc` (`database_id`). Change `INTEGRATION_URL` if you publish your own integration.
3. *Workers & Pages → Create application → Connect GitHub*, choose the repository, keep the project name `access` (or change `name` in `wrangler.jsonc`), deploy command `npx wrangler deploy`.
4. In the Worker's *Settings → Variables and Secrets* add two **Secrets**, at least 32 random characters each: `PIN_PEPPER` (never change it later, existing PINs would stop working) and `ADMIN_TOKEN` (your administrator password).
5. Open `https://access.<your-subdomain>.workers.dev/admin`, log in with `ADMIN_TOKEN` and create invite codes.

Every push deploys automatically. Database changes are applied by the Worker itself on first start of a new version.

## Administrator page

`/admin`: create one-time invite codes (valid 1 day to 2 years) with a ready message for your friend, cancel unused codes, see connected homes (online state, active panels) and block or unblock a home. Ten wrong logins from one IP address block logins from it for 15 minutes.

## API

| Method and path | Auth | Purpose |
| --- | --- | --- |
| `POST /api/v1/admin/invites` | `ADMIN_TOKEN` | New invite code (`ttl_days` 1–730) |
| `GET /api/v1/admin/invites` | `ADMIN_TOKEN` | Unused codes (hashes only) |
| `DELETE /api/v1/admin/invites/{id}` | `ADMIN_TOKEN` | Cancel a code |
| `GET /api/v1/admin/instances` | `ADMIN_TOKEN` | Connected homes |
| `POST /api/v1/admin/instances/{id}/block` | `ADMIN_TOKEN` | Block or unblock a home |
| `POST /api/v1/instances` | invite code | Register a home, returns `instance_id` and `api_key` |
| `GET /api/v1/instances/{id}/ws?after={seq}` | instance key | WebSocket: guest commands to HA, acknowledgements and values from HA |
| `POST /api/v1/panels` | instance key | Create a panel |
| `GET /api/v1/panels`, `GET /api/v1/panels/{id}` | instance key | Panels and their status |
| `DELETE /api/v1/panels/{id}` | instance key | Revoke now |
| `POST /api/v1/panels/{id}/unlock` | instance key | Unlock after too many wrong PINs |
| `GET /api/v1/panels/{id}/log` | instance key | Panel log |

Control types: `switch`, `button`, `sensor` (read-out only). `show_state: true` shows a switch or button state to the guest.

WebSocket messages: `hello` (portal → HA), `command` (portal → HA), `ack` (HA → portal), `state` (HA → portal: `panel_id`, `control_id`, `state`, `unit`, `device_class`, `domain`), `ping`/`pong`. Close codes: `4001` replaced by a newer connection, `4003` home blocked. Commands older than 30 seconds expire.

## Security

- Links carry 128 random bits; PINs are stored as an HMAC with `PIN_PEPPER`. Five wrong PINs from one IP lock it for 15 minutes, twenty in total lock the panel until the owner unlocks it.
- Guest sessions are `HttpOnly`, `Secure`, `SameSite=Strict` cookies, 12 hours at most.
- Instance keys, invite codes and sessions are stored as SHA-256 hashes only.
- The portal never knows entity IDs, and Home Assistant makes the final decision on every command.
- Guest and admin pages load nothing from third parties (strict CSP).
- Panels ended more than 7 days ago are deleted daily with their logs and values.

## Local development

```
npm install
cp .dev.vars.example .dev.vars
npm run dev                 # http://127.0.0.1:8787
npm run test:e2e            # 79 end-to-end tests, including a fake Home Assistant
```
