import 'server-only';
import { serverEnv, isConfigured } from '@/lib/env';
import { publicEnv } from '@/lib/env';
import { classifyMetaError, classifyTransportError, PublishError, type MetaErrorBody } from '@/lib/social/errors';
import { logger } from '@/lib/logger';

/**
 * Meta Graph API client.
 *
 * This is the real integration: OAuth code exchange, long-lived token
 * exchange, Page and Instagram-business-account discovery, the two-step
 * Instagram publish, Facebook Page posting, token inspection and revocation.
 *
 * What it deliberately does NOT do:
 *   - It never falls back to a fabricated response. A call that cannot be made
 *     throws `PublishError('unavailable' | 'needs_reconnect')`, which the
 *     worker records honestly. The previous code stored
 *     `placeholder_token_for_<code>` and reported the account as connected.
 *   - It never logs a token. Access tokens are passed as query parameters
 *     because that is the API Meta exposes, so the request URL itself is a
 *     credential: `redactUrl` strips it before anything reaches a log.
 *
 * Timeouts are explicit. `fetch` has no default timeout, and a hung Graph
 * request would otherwise hold a job lease until it expired.
 */

const GRAPH_HOST = 'https://graph.facebook.com';
const DEFAULT_TIMEOUT_MS = 30_000;
/** Instagram containers are processed asynchronously; publishing waits for them. */
const CONTAINER_POLL_INTERVAL_MS = 3_000;
const CONTAINER_POLL_ATTEMPTS = 20;

function graphUrl(path: string): string {
  const version = serverEnv.metaGraphVersion;
  return `${GRAPH_HOST}/${version}/${path.replace(/^\//, '')}`;
}

/** Strips credential-bearing parameters so a URL can be logged. */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url);
    for (const key of ['access_token', 'client_secret', 'code', 'fb_exchange_token', 'input_token']) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, 'REDACTED');
    }
    return parsed.toString();
  } catch {
    return '[unparseable url]';
  }
}

interface GraphRequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  /** Sent as form-encoded body on POST, query string otherwise. */
  params?: Record<string, string | number | undefined>;
  accessToken?: string;
  timeoutMs?: number;
}

/**
 * One Graph API call, with classification.
 *
 * Every failure path returns a `PublishError` so callers never have to guess
 * whether to retry.
 */
export async function graphRequest<T>(path: string, options: GraphRequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET';
  const url = new URL(graphUrl(path));
  const body = new URLSearchParams();

  const params = { ...(options.params ?? {}) };
  if (options.accessToken) params.access_token = options.accessToken;

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    if (method === 'GET' || method === 'DELETE') url.searchParams.set(key, String(value));
    else body.set(key, String(value));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      signal: controller.signal,
      headers: method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : undefined,
      body: method === 'POST' ? body.toString() : undefined,
      // Never cache a credentialed call.
      cache: 'no-store',
    });
  } catch (error) {
    throw classifyTransportError(error);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // A non-JSON body from Graph means something upstream (a proxy, an error
    // page) answered instead. Retryable.
    if (!response.ok) {
      throw new PublishError('retryable', `meta_non_json_${response.status}`, `Meta returned a non-JSON response (HTTP ${response.status}).`);
    }
  }

  if (!response.ok) {
    const error = classifyMetaError(response.status, parsed as MetaErrorBody | null, response.headers.get('retry-after'));
    logger.warn('meta:request_failed', {
      url: redactUrl(url.toString()),
      status: response.status,
      kind: error.kind,
      code: error.code,
    });
    throw error;
  }

  return parsed as T;
}

/* ------------------------------------------------------------------ *
 * OAuth
 * ------------------------------------------------------------------ */

/** The redirect URI Meta must be configured with. Derived, never client-supplied. */
export function metaRedirectUri(): string {
  return `${publicEnv.siteUrl}/api/social/oauth/callback`;
}

/**
 * Builds the authorization URL.
 *
 * `state` is required — there is no overload without it, so a caller cannot
 * accidentally start an unprotected flow.
 */
export function metaAuthorizationUrl(state: string, scopes: string[]): string {
  if (!isConfigured.metaOAuth()) {
    throw new PublishError(
      'unavailable',
      'meta_not_configured',
      'Meta publishing is not configured on this server. Set META_APP_ID, META_APP_SECRET and TOKEN_ENCRYPTION_KEY.'
    );
  }

  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth');
  url.searchParams.set('client_id', serverEnv.metaAppId);
  url.searchParams.set('redirect_uri', metaRedirectUri());
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scopes.join(','));
  url.searchParams.set('response_type', 'code');
  return url.toString();
}

export interface MetaTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** Exchanges the short-lived code from the redirect for a user access token. */
export async function exchangeCodeForToken(code: string): Promise<MetaTokenResponse> {
  return graphRequest<MetaTokenResponse>('oauth/access_token', {
    params: {
      client_id: serverEnv.metaAppId,
      client_secret: serverEnv.metaAppSecret,
      redirect_uri: metaRedirectUri(),
      code,
    },
  });
}

/**
 * Upgrades a short-lived user token to a long-lived one (~60 days).
 *
 * Skipping this is the classic Meta integration bug: publishing works for an
 * hour after connecting and then every scheduled post fails.
 */
export async function exchangeForLongLivedToken(shortLivedToken: string): Promise<MetaTokenResponse> {
  return graphRequest<MetaTokenResponse>('oauth/access_token', {
    params: {
      grant_type: 'fb_exchange_token',
      client_id: serverEnv.metaAppId,
      client_secret: serverEnv.metaAppSecret,
      fb_exchange_token: shortLivedToken,
    },
  });
}

export interface MetaDebugToken {
  data?: {
    is_valid?: boolean;
    expires_at?: number;
    scopes?: string[];
    app_id?: string;
    user_id?: string;
  };
}

/**
 * Inspects a token: validity, expiry and granted scopes.
 *
 * Authenticated with an app access token (`<id>|<secret>`) rather than the
 * token being inspected, so a revoked token still returns a useful answer.
 * The granted scope list is what lets the UI say "reconnect to grant
 * instagram_content_publish" instead of failing at publish time.
 */
export async function debugToken(token: string): Promise<MetaDebugToken> {
  return graphRequest<MetaDebugToken>('debug_token', {
    params: {
      input_token: token,
      access_token: `${serverEnv.metaAppId}|${serverEnv.metaAppSecret}`,
    },
  });
}

export interface MetaPage {
  id: string;
  name: string;
  access_token: string;
  /** Present only when the Page has a linked Instagram business account. */
  instagram_business_account?: { id: string; username?: string };
  tasks?: string[];
}

/**
 * Lists the Pages the user administers, with each Page's own token.
 *
 * Publishing uses the PAGE token, not the user token: a user token cannot post
 * to a Page, and Page tokens derived from a long-lived user token do not
 * expire on their own.
 */
export async function listPages(userAccessToken: string): Promise<MetaPage[]> {
  const response = await graphRequest<{ data?: MetaPage[] }>('me/accounts', {
    params: {
      fields: 'id,name,access_token,tasks,instagram_business_account{id,username}',
      limit: 100,
    },
    accessToken: userAccessToken,
  });

  return response.data ?? [];
}

/** Revokes the app's permissions for a user. Called on disconnect. */
export async function revokePermissions(userId: string, accessToken: string): Promise<void> {
  await graphRequest(`${userId}/permissions`, { method: 'DELETE', accessToken });
}

/* ------------------------------------------------------------------ *
 * Publishing
 * ------------------------------------------------------------------ */

export interface MetaPublishTarget {
  /** Page id for Facebook, IG business account id for Instagram. */
  targetId: string;
  pageAccessToken: string;
}

/**
 * Publishes to a Facebook Page.
 *
 * A photo post and a link/text post are different endpoints, so the shape of
 * the request depends on what the caller actually has.
 */
export async function publishFacebookPost(
  target: MetaPublishTarget,
  input: { caption?: string; mediaUrls: string[] }
): Promise<{ id: string }> {
  if (input.mediaUrls.length === 0) {
    return graphRequest<{ id: string }>(`${target.targetId}/feed`, {
      method: 'POST',
      params: { message: input.caption ?? '' },
      accessToken: target.pageAccessToken,
    });
  }

  if (input.mediaUrls.length === 1) {
    return graphRequest<{ id: string }>(`${target.targetId}/photos`, {
      method: 'POST',
      params: { url: input.mediaUrls[0], caption: input.caption ?? '' },
      accessToken: target.pageAccessToken,
    });
  }

  // Multi-photo: upload each unpublished, then attach them to one feed post.
  const attachedIds: string[] = [];
  for (const url of input.mediaUrls) {
    const photo = await graphRequest<{ id: string }>(`${target.targetId}/photos`, {
      method: 'POST',
      params: { url, published: 'false' },
      accessToken: target.pageAccessToken,
    });
    attachedIds.push(photo.id);
  }

  const params: Record<string, string> = { message: input.caption ?? '' };
  attachedIds.forEach((id, index) => {
    params[`attached_media[${index}]`] = JSON.stringify({ media_fbid: id });
  });

  return graphRequest<{ id: string }>(`${target.targetId}/feed`, {
    method: 'POST',
    params,
    accessToken: target.pageAccessToken,
  });
}

interface ContainerStatus {
  status_code?: 'EXPIRED' | 'ERROR' | 'FINISHED' | 'IN_PROGRESS' | 'PUBLISHED';
  status?: string;
}

/**
 * Waits for an Instagram media container to finish processing.
 *
 * Publishing a container that is still IN_PROGRESS fails, so this is not
 * optional. It is bounded: `CONTAINER_POLL_ATTEMPTS * CONTAINER_POLL_INTERVAL_MS`
 * is a minute, comfortably inside the job lease.
 */
async function waitForContainer(containerId: string, accessToken: string): Promise<void> {
  for (let attempt = 0; attempt < CONTAINER_POLL_ATTEMPTS; attempt += 1) {
    const status = await graphRequest<ContainerStatus>(containerId, {
      params: { fields: 'status_code,status' },
      accessToken,
    });

    if (status.status_code === 'FINISHED' || status.status_code === 'PUBLISHED') return;

    if (status.status_code === 'ERROR' || status.status_code === 'EXPIRED') {
      throw new PublishError(
        'permanent',
        `ig_container_${status.status_code.toLowerCase()}`,
        `Instagram rejected the media while processing it: ${status.status ?? status.status_code}.`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, CONTAINER_POLL_INTERVAL_MS));
  }

  // Still processing. Retryable: the container may finish, and a later attempt
  // will find it ready.
  throw new PublishError(
    'retryable',
    'ig_container_timeout',
    'Instagram is still processing the media. This will be retried.',
    { retryAfterSeconds: 120 }
  );
}

/**
 * Publishes to Instagram.
 *
 * Two steps, or three for a carousel: create container(s), wait for
 * processing, then publish. There is no single-call publish in the content
 * publishing API.
 */
export async function publishInstagramPost(
  target: MetaPublishTarget,
  input: { caption?: string; mediaUrls: string[]; isVideo?: boolean }
): Promise<{ id: string }> {
  if (input.mediaUrls.length === 0) {
    throw new PublishError('permanent', 'ig_media_required', 'Instagram posts must include at least one image or video.');
  }

  const { targetId, pageAccessToken } = target;

  if (input.mediaUrls.length === 1) {
    const container = await graphRequest<{ id: string }>(`${targetId}/media`, {
      method: 'POST',
      params: input.isVideo
        ? { video_url: input.mediaUrls[0], media_type: 'REELS', caption: input.caption ?? '' }
        : { image_url: input.mediaUrls[0], caption: input.caption ?? '' },
      accessToken: pageAccessToken,
    });

    await waitForContainer(container.id, pageAccessToken);

    return graphRequest<{ id: string }>(`${targetId}/media_publish`, {
      method: 'POST',
      params: { creation_id: container.id },
      accessToken: pageAccessToken,
    });
  }

  // Carousel: each child is an unpublished container, then one parent.
  const childIds: string[] = [];
  for (const url of input.mediaUrls) {
    const child = await graphRequest<{ id: string }>(`${targetId}/media`, {
      method: 'POST',
      params: { image_url: url, is_carousel_item: 'true' },
      accessToken: pageAccessToken,
    });
    childIds.push(child.id);
  }

  for (const childId of childIds) {
    await waitForContainer(childId, pageAccessToken);
  }

  const parent = await graphRequest<{ id: string }>(`${targetId}/media`, {
    method: 'POST',
    params: {
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption: input.caption ?? '',
    },
    accessToken: pageAccessToken,
  });

  await waitForContainer(parent.id, pageAccessToken);

  return graphRequest<{ id: string }>(`${targetId}/media_publish`, {
    method: 'POST',
    params: { creation_id: parent.id },
    accessToken: pageAccessToken,
  });
}

/** Best-effort permalink. A post with no retrievable URL is still published. */
export async function fetchPermalink(
  postId: string,
  accessToken: string,
  platform: 'facebook' | 'instagram'
): Promise<string | null> {
  try {
    const field = platform === 'instagram' ? 'permalink' : 'permalink_url';
    const response = await graphRequest<Record<string, string>>(postId, {
      params: { fields: field },
      accessToken,
    });
    return response[field] ?? null;
  } catch {
    return null;
  }
}
