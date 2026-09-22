/**
 * Profile + settings (05 section 3, 04 section 2.5).
 * A user may only ever read/update their OWN rows: the user id comes from
 * the session, never from the request.
 */
import { avatarSchema, profileUpdateSchema, settingsUpdateSchema } from '../../shared/validation';
import type { Env } from '../lib/config';
import { auditStatement } from '../lib/audit';
import { batch, mapProfile, mapSettings, queryFirst, stmt } from '../lib/db';
import { json, notFound } from '../lib/http';
import type { SessionContext } from '../middleware/auth';
import { parseBody } from '../middleware/validation';

export async function getProfile(env: Env, session: SessionContext): Promise<Response> {
  const [p, s] = await Promise.all([
    queryFirst<Record<string, unknown>>(env, 'SELECT * FROM profiles WHERE user_id = ?', [
      session.userId,
    ]),
    queryFirst<Record<string, unknown>>(env, 'SELECT * FROM user_settings WHERE user_id = ?', [
      session.userId,
    ]),
  ]);
  if (!p) throw notFound('Profile not found');
  return json({
    profile: mapProfile(p),
    settings: s
      ? mapSettings(s)
      : {
          userId: session.userId,
          theme: 'light',
          dateFormat: 'DD MMM YYYY',
          updatedAt: Date.now(),
        },
  });
}

export async function patchProfile(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, profileUpdateSchema);
  const now = Date.now();

  const sets: string[] = [];
  const params: unknown[] = [];
  const changed: string[] = [];

  if (body.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(body.displayName);
    changed.push('displayName');
  }
  if (body.fullName !== undefined) {
    sets.push('full_name = ?');
    params.push(body.fullName || null);
    changed.push('fullName');
  }
  if (body.bio !== undefined) {
    sets.push('bio = ?');
    params.push(body.bio || null);
    changed.push('bio');
  }

  sets.push('updated_at = ?');
  params.push(now, session.userId);

  const statements = [
    stmt(env, `UPDATE profiles SET ${sets.join(', ')} WHERE user_id = ?`, params),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: 'PROFILE_UPDATED',
        resourceType: 'profile',
        resourceId: session.userId,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { fields: changed },
      },
      now,
    ),
  ];
  if (changed.includes('displayName')) {
    statements.push(
      auditStatement(
        env,
        {
          userId: session.userId,
          actorRole: 'USER',
          action: 'DISPLAY_NAME_CHANGED',
          resourceType: 'profile',
          resourceId: session.userId,
          scope: 'USER',
          result: 'SUCCESS',
        },
        now,
      ),
    );
  }
  if (changed.includes('bio')) {
    statements.push(
      auditStatement(
        env,
        {
          userId: session.userId,
          actorRole: 'USER',
          action: 'BIO_CHANGED',
          resourceType: 'profile',
          resourceId: session.userId,
          scope: 'USER',
          result: 'SUCCESS',
        },
        now,
      ),
    );
  }

  await batch(env, statements);
  const p = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM profiles WHERE user_id = ?',
    [session.userId],
  );
  return json({ profile: p ? mapProfile(p) : null });
}

export async function putAvatar(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, avatarSchema);
  const now = Date.now();
  await batch(env, [
    stmt(env, 'UPDATE profiles SET avatar_url = ?, updated_at = ? WHERE user_id = ?', [
      body.imageDataUrl,
      now,
      session.userId,
    ]),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: 'AVATAR_UPDATED',
        resourceType: 'profile',
        resourceId: session.userId,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { bytes: body.imageDataUrl.length },
      },
      now,
    ),
  ]);
  return json({ ok: true });
}

export async function patchSettings(
  req: Request,
  env: Env,
  session: SessionContext,
): Promise<Response> {
  const body = await parseBody(req, settingsUpdateSchema);
  const now = Date.now();

  // Ensure the row exists (defaults), then update only the provided fields.
  // Two statements in one batch keeps it atomic and avoids the excluded.*
  // pitfall where a defaulted INSERT value would clobber an existing choice.
  const statements = [
    stmt(
      env,
      `INSERT INTO user_settings (user_id, theme, date_format, updated_at)
       VALUES (?, 'light', 'DD MMM YYYY', ?)
       ON CONFLICT(user_id) DO NOTHING`,
      [session.userId, now],
    ),
    stmt(
      env,
      `UPDATE user_settings
          SET theme = COALESCE(?, theme),
              date_format = COALESCE(?, date_format),
              updated_at = ?
        WHERE user_id = ?`,
      [body.theme ?? null, body.dateFormat ?? null, now, session.userId],
    ),
    auditStatement(
      env,
      {
        userId: session.userId,
        actorRole: 'USER',
        action: body.theme !== undefined ? 'THEME_CHANGED' : 'SETTINGS_UPDATED',
        resourceType: 'user_settings',
        resourceId: session.userId,
        scope: 'USER',
        result: 'SUCCESS',
        metadata: { theme: body.theme, dateFormat: body.dateFormat },
      },
      now,
    ),
  ];

  await batch(env, statements);
  const s = await queryFirst<Record<string, unknown>>(
    env,
    'SELECT * FROM user_settings WHERE user_id = ?',
    [session.userId],
  );
  return json({ settings: s ? mapSettings(s) : null });
}
