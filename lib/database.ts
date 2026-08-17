import { Pool, QueryResult, QueryResultRow } from 'pg';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required');
}

const pool = new Pool({
  connectionString,
  max: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});

// Handle pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

// Test connection function
export const testConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    await client.query('SELECT NOW()');
    client.release();
    console.log('Database connection successful!');
    return true;
  } catch (error) {
    console.error('Database connection failed:', error);
    return false;
  }
};

// Query function
export const query = async <Row extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<QueryResult<Row>> => {
  const start = Date.now();
  const res = await pool.query<Row>(text, params);
  const duration = Date.now() - start;
  console.log('Executed query', { text, duration, rows: res.rowCount });
  return res;
};

// Get client from pool
export const getClient = async () => {
  return await pool.connect();
};

// Close pool
export const closePool = async () => {
  await pool.end();
};

export default pool;
