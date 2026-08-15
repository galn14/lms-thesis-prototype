export interface DatabaseTargetIdentity {
  branchHost: string;
  database: string;
}

const POSTGRES_PROTOCOLS = new Set(['postgres:', 'postgresql:']);

export function databaseTargetIdentity(connectionString: string): DatabaseTargetIdentity {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error('Database connection must be a valid PostgreSQL URL');
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ''));
  if (!POSTGRES_PROTOCOLS.has(parsed.protocol) || !parsed.hostname || !database) {
    throw new Error('Database connection must be a valid PostgreSQL URL');
  }
  const hostParts = parsed.hostname.toLowerCase().split('.');
  hostParts[0] = hostParts[0].replace(/-pooler$/, '');
  return { branchHost: hostParts.join('.'), database };
}

export function assertSameDatabaseTarget(
  leftUrl: string,
  rightUrl: string,
  leftName: string,
  rightName: string
): void {
  const left = databaseTargetIdentity(leftUrl);
  const right = databaseTargetIdentity(rightUrl);
  if (left.branchHost !== right.branchHost || left.database !== right.database) {
    throw new Error(
      `${leftName} and ${rightName} must identify the same Neon branch and database`
    );
  }
}
