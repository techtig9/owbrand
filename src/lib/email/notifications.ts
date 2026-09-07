/**
 * The two notifications the master command asks for: signup and sign-in.
 *
 * Deliberately narrow. "Do NOT send excessive emails" is an explicit
 * requirement, so sign-in notification is OFF by default (EMAIL_NOTIFY_SIGNIN)
 * and additionally de-duplicated so a user who signs in five times in an hour
 * receives one mail, not five.
 *
 * Nothing in this module is allowed to throw into an auth path.
 */
import { publicEnv, serverEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendEmail, type SendEmailResult } from '@/lib/email/client';
import { signupNotification, signinNotification } from '@/lib/email/templates';

const SIGNIN_DEDUPE_WINDOW_MINUTES = 60;

export interface SignupNotificationInput {
  userId: string;
  email: string;
  name?: string | null;
}

/** Sent once when an account is created. */
export async function sendSignupNotification(input: SignupNotificationInput): Promise<SendEmailResult> {
  if (!serverEnv.notifyOnSignup) {
    return { status: 'skipped', reason: 'signup_notification_disabled' };
  }

  try {
    return await sendEmail({
      to: input.email,
      template: 'signup_notification',
      userId: input.userId,
      content: signupNotification({ name: input.name ?? null, siteUrl: publicEnv.siteUrl }),
    });
  } catch (error) {
    logger.error('notifications:signup_failed', error, { userId: input.userId });
    return { status: 'failed', reason: 'unexpected_error' };
  }
}

export interface SigninNotificationInput {
  userId: string;
  email: string;
  name?: string | null;
  /** 'email', 'google', … — describes how the session was established. */
  method: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Sent on a new sign-in, when enabled. Rate-limited per user so repeated logins
 * in a short window produce a single message.
 */
export async function sendSigninNotification(input: SigninNotificationInput): Promise<SendEmailResult> {
  if (!serverEnv.notifyOnSignin) {
    return { status: 'skipped', reason: 'signin_notification_disabled' };
  }

  try {
    if (await recentlyNotified(input.userId)) {
      return { status: 'skipped', reason: 'deduplicated' };
    }

    return await sendEmail({
      to: input.email,
      template: 'signin_notification',
      userId: input.userId,
      // The IP is used only to derive the audit row; it is never placed in the
      // email body, and the raw value is not stored in metadata.
      metadata: { method: input.method },
      content: signinNotification({
        name: input.name ?? null,
        method: input.method,
        at: new Date(),
        device: describeDevice(input.userAgent),
        siteUrl: publicEnv.siteUrl,
      }),
    });
  } catch (error) {
    logger.error('notifications:signin_failed', error, { userId: input.userId });
    return { status: 'failed', reason: 'unexpected_error' };
  }
}

/**
 * Decides which notification a completed authentication deserves and sends it.
 *
 * A user's first successful authentication gets the welcome mail; every later
 * one is a candidate for the (opt-in, de-duplicated) sign-in notice. This is
 * driven off email_logs rather than a "welcomed" flag so it stays correct if
 * the notification is enabled later.
 */
export async function sendAuthEventNotification(
  input: SigninNotificationInput
): Promise<SendEmailResult & { kind: 'signup' | 'signin' }> {
  const alreadyWelcomed = await hasReceivedSignupNotification(input.userId);

  if (!alreadyWelcomed) {
    const result = await sendSignupNotification({
      userId: input.userId,
      email: input.email,
      name: input.name,
    });
    return { ...result, kind: 'signup' };
  }

  const result = await sendSigninNotification(input);
  return { ...result, kind: 'signin' };
}

async function hasReceivedSignupNotification(userId: string): Promise<boolean> {
  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from('email_logs')
      .select('id')
      .eq('user_id', userId)
      .eq('template', 'signup_notification')
      .in('status', ['sent', 'skipped'])
      .limit(1);
    return Boolean(data && data.length > 0);
  } catch {
    // Unknown: treat as already welcomed so we never spam a welcome mail on
    // every login because the log table is unreachable.
    return true;
  }
}

/** True when this user already got a sign-in notice inside the dedupe window. */
async function recentlyNotified(userId: string): Promise<boolean> {
  try {
    const since = new Date(Date.now() - SIGNIN_DEDUPE_WINDOW_MINUTES * 60_000).toISOString();
    const db = supabaseAdmin();
    const { data } = await db
      .from('email_logs')
      .select('id')
      .eq('user_id', userId)
      .eq('template', 'signin_notification')
      .eq('status', 'sent')
      .gte('created_at', since)
      .limit(1);
    return Boolean(data && data.length > 0);
  } catch {
    // If the check fails, prefer sending over silently dropping a security
    // notification.
    return false;
  }
}

/**
 * Coarse, non-identifying device description. Deliberately does not fingerprint:
 * the goal is "was this you?", not tracking.
 */
function describeDevice(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;

  const os = /Windows/i.test(userAgent)
    ? 'Windows'
    : /Macintosh|Mac OS X/i.test(userAgent)
      ? 'macOS'
      : /Android/i.test(userAgent)
        ? 'Android'
        : /iPhone|iPad|iOS/i.test(userAgent)
          ? 'iOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : null;

  const browser = /Edg\//i.test(userAgent)
    ? 'Edge'
    : /OPR\//i.test(userAgent)
      ? 'Opera'
      : /Chrome\//i.test(userAgent)
        ? 'Chrome'
        : /Safari\//i.test(userAgent)
          ? 'Safari'
          : /Firefox\//i.test(userAgent)
            ? 'Firefox'
            : null;

  if (!os && !browser) return null;
  return [browser, os].filter(Boolean).join(' on ');
}
