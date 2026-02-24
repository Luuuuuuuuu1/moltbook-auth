# moltbook-auth

An [openclaw](https://github.com/openclaw/openclaw) plugin that adds "Sign in with Moltbook" authentication to your gateway. AI agents can authenticate using their Moltbook identity, and their verified profile (name, karma, owner info) is attached to the request for downstream handlers.

## How it works

For every incoming request, the middleware checks for an `X-Moltbook-Identity` header. If present, it calls the Moltbook verify-identity API using your app key. On success, the verified agent profile is attached to the request and openclaw processes it normally. On failure, an appropriate error is returned immediately.

Requests without the header are passed through to openclaw's normal auth unchanged.

```
Request
  │
  ├─ No X-Moltbook-Identity header → pass through to openclaw auth
  │
  └─ X-Moltbook-Identity: <token>
       │
       ├─ valid   → attach agent to request, continue
       ├─ expired → 401 identity_token_expired
       ├─ invalid → 401 invalid_token
       └─ error   → 502 verification_failed
```

## Installation

Copy or link the plugin into your openclaw extensions directory:

```bash
cp -r moltbook-auth ~/.openclaw/extensions/
```

Add your Moltbook app key to `~/.openclaw/.env`:

```
MOLTBOOK_APP_KEY=mk_live_...
```

Add `moltbook-auth` to `plugins.allow` in `~/.openclaw/openclaw.json`:

```json
{
  "plugins": {
    "allow": ["moltbook-auth"]
  }
}
```

Restart the gateway:

```bash
openclaw gateway restart
```

## Accessing the verified agent

In route handlers registered via `api.registerHttpRoute`, import the `verifiedAgents` WeakMap to read the authenticated agent profile:

```ts
import { verifiedAgents } from "~/.openclaw/extensions/moltbook-auth/index.ts";

api.registerHttpRoute({
  path: "/v1/my-endpoint",
  handler(req, res) {
    const agent = verifiedAgents.get(req);
    // agent.id, agent.name, agent.karma, agent.owner.x_handle, ...
  },
});
```

## Agent profile shape

```ts
interface MoltbookAgent {
  id: string;
  name: string;
  karma: number;
  avatar_url: string;
  is_claimed: boolean;
  owner: {
    x_handle: string;
    x_verified: boolean;
  };
}
```

## Requirements

- [openclaw](https://github.com/openclaw/openclaw) ≥ 2026.2.22
- A Moltbook app key from the [Moltbook developer dashboard](https://moltbook.com/developers/dashboard)
