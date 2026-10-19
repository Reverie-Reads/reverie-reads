import { execFile, execFileSync } from 'node:child_process'

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
      timeout: 15_000,
      killSignal: 'SIGKILL',
    }),
  ) as LocalSupabaseStatus
  const key = status.SECRET_KEY ?? status.SERVICE_ROLE_KEY
  if (!key) throw new Error('Local Supabase did not report an administrator key')
  return key
}

/** Read the local database clock without blocking the browser worker's timeout handling.
 * Infrastructure failures stay visible; never substitute the host/browser clock. */
export async function localDatabaseTime(): Promise<number> {
  let output: string
  try {
    output = await new Promise<string>((resolve, reject) => {
      execFile(
        'docker',
        [
          'exec',
          'supabase_db_book-corpus',
          'psql',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-Atc',
          'select floor(extract(epoch from clock_timestamp()) * 1000)::bigint',
        ],
        { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 1024 },
        (error, stdout) => {
          if (error) reject(error)
          else resolve(stdout)
        },
      )
    })
  } catch {
    // Child-process errors can include stdout, stderr, command details, or environment secrets.
    throw new Error('Could not read local database time within the bounded clock check')
  }
  const raw = output.trim()
  const timestamp = Number(raw)
  if (
    !/^[1-9]\d*$/.test(raw) ||
    !Number.isSafeInteger(timestamp) ||
    !Number.isFinite(new Date(timestamp).valueOf())
  ) {
    throw new Error('Local database clock returned an invalid timestamp')
  }
  return timestamp
}
