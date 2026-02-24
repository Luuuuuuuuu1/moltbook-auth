import type { IncomingMessage, ServerResponse } from "node:http";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

const MOLTBOOK_VERIFY_URL = "https://moltbook.com/api/v1/agents/verify-identity";

interface MoltbookAgentOwner {
  x_handle: string;
  x_verified: boolean;
}

export interface MoltbookAgent {
  id: string;
  name: string;
  karma: number;
  avatar_url: string;
  is_claimed: boolean;
  owner: MoltbookAgentOwner;
}

type VerifyResult =
  | { valid: true; agent: MoltbookAgent }
  | { valid: false; error: string };

/**
 * WeakMap that stores the verified Moltbook agent for a given request.
 * Route handlers registered via api.registerHttpRoute can call
 * verifiedAgents.get(req) to access the authenticated agent profile.
 */
export const verifiedAgents = new WeakMap<IncomingMessage, MoltbookAgent>();

async function verifyIdentityToken(token: string, appKey: string): Promise<VerifyResult> {
  const response = await fetch(MOLTBOOK_VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Moltbook-App-Key": appKey,
    },
    body: JSON.stringify({ token }),
  });

  const data = (await response.json()) as {
    valid: boolean;
    agent?: MoltbookAgent;
    error?: string;
  };

  if (data.valid && data.agent) {
    return { valid: true, agent: data.agent };
  }

  return { valid: false, error: data.error ?? "invalid_token" };
}

function sendJsonError(
  res: ServerResponse,
  status: number,
  error: string,
  message: string,
): void {
  const body = JSON.stringify({ error, message });
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(body)),
  });
  res.end(body);
}

const ERROR_MESSAGES: Record<string, string> = {
  identity_token_expired: "Moltbook identity token has expired",
  invalid_token: "Invalid Moltbook identity token",
  invalid_app_key: "Invalid Moltbook app key — check your MOLTBOOK_APP_KEY config",
};

const moltbookAuthPlugin = {
  id: "moltbook-auth",
  name: "Moltbook Auth",
  description: "Verify incoming AI agent requests using Moltbook identity tokens",
  configSchema: {
    jsonSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },

  register(api: OpenClawPluginApi) {
    const appKey = process.env.MOLTBOOK_APP_KEY?.trim();

    if (!appKey) {
      api.logger.warn(
        "[moltbook-auth] MOLTBOOK_APP_KEY is not set — Moltbook identity verification is disabled",
      );
      return;
    }

    api.registerHttpHandler(async (req: IncomingMessage, res: ServerResponse) => {
      const raw = req.headers["x-moltbook-identity"];
      const identityToken = (Array.isArray(raw) ? raw[0] : raw)?.trim();

      // No Moltbook token — pass through to openclaw's normal auth
      if (!identityToken) {
        return false;
      }

      try {
        const result = await verifyIdentityToken(identityToken, appKey);

        if (!result.valid) {
          const isServerError = result.error === "invalid_app_key";
          sendJsonError(
            res,
            isServerError ? 500 : 401,
            result.error,
            ERROR_MESSAGES[result.error] ?? "Moltbook identity verification failed",
          );
          return true; // request handled — stop further processing
        }

        // Attach the verified agent to the request for downstream route handlers
        verifiedAgents.set(req, result.agent);

        // Inject the openclaw gateway token so the request passes openclaw's own
        // auth check (works when gateway.auth.mode = "token")
        const gatewayToken = api.config.gateway?.auth?.token;
        if (gatewayToken) {
          (req.headers as Record<string, string>)["authorization"] =
            `Bearer ${gatewayToken}`;
        }

        api.logger.info(
          `[moltbook-auth] Authenticated: ${result.agent.name} (id=${result.agent.id}, karma=${result.agent.karma})`,
        );
        return false; // let openclaw continue processing the authenticated request
      } catch (err) {
        api.logger.error(
          `[moltbook-auth] Verification request failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        sendJsonError(
          res,
          502,
          "verification_failed",
          "Failed to reach Moltbook verification service",
        );
        return true;
      }
    });

    api.logger.info("[moltbook-auth] Moltbook identity auth middleware registered");
  },
};

export default moltbookAuthPlugin;
