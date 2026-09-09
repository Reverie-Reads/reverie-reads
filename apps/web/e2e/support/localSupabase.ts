import { execFileSync } from 'node:child_process'

type LocalSupabaseStatus = {
  SECRET_KEY?: string
  SERVICE_ROLE_KEY?: string
}

/** Read the administrator credential exposed by the running local stack. Newer Auth images prefer
 * the asymmetric local secret; older CI images expose only the legacy service-role JWT. */
export function localAdminKey(): string {
  const status = JSON.parse(
    execFileSync('supabase', ['status', '-o', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }),
  ) as LocalSupabaseStatus
  const key = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
  if (!key) throw new Error('Local Supabase did not report an administrator key')
  return key
}
