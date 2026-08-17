describe('password hashing', () => {
  it('hashes with twelve rounds and delegates password verification', async () => {
    jest.resetModules();
    const hash = jest.fn().mockResolvedValue('hashed');
    const compare = jest.fn().mockResolvedValue(true);
    jest.doMock('bcryptjs', () => ({ __esModule: true, default: { hash, compare } }));
    const hashModule = await import('@/lib/hash');
    await expect(hashModule.hashPassword('secret')).resolves.toBe('hashed');
    await expect(hashModule.verifyPassword('secret', 'hashed')).resolves.toBe(true);
    expect(hash).toHaveBeenCalledWith('secret', 12);
    expect(compare).toHaveBeenCalledWith('secret', 'hashed');
  });
});

describe('legacy postgres client configuration', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.dontMock('postgres');
  });

  it.each([
    ['development', false],
    ['production', { rejectUnauthorized: false }],
  ] as const)('configures %s connections from DATABASE_URL', async (nodeEnv, ssl) => {
    process.env = {
      ...originalEnv,
      NODE_ENV: nodeEnv,
      DATABASE_URL: 'postgresql://user:password@ep-demo-pooler.region.aws.neon.tech/lms',
    };
    const client = jest.fn();
    const postgres = jest.fn(() => client);
    jest.doMock('postgres', () => ({ __esModule: true, default: postgres }));
    const databaseModule = await import('@/lib/db');
    expect(databaseModule.default).toBe(client);
    expect(postgres).toHaveBeenCalledWith(
      'postgresql://user:password@ep-demo-pooler.region.aws.neon.tech/lms',
      { ssl, max: 2 }
    );
  });

  it('fails fast without DATABASE_URL instead of using legacy connection variables', async () => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    process.env.POSTGRES_HOST = 'legacy.example';
    jest.doMock('postgres', () => ({ __esModule: true, default: jest.fn() }));
    await expect(import('@/lib/db')).rejects.toThrow('DATABASE_URL is required');
  });
});

describe('AI instructor roles', () => {
  it('accepts instructor aliases case-insensitively and rejects other values', async () => {
    const { isAiInstructorRole } = await import('@/lib/auth/ai-role');
    expect(isAiInstructorRole(' guru ')).toBe(true);
    expect(isAiInstructorRole('teacher')).toBe(true);
    expect(isAiInstructorRole('ADMIN')).toBe(true);
    expect(isAiInstructorRole('student')).toBe(false);
    expect(isAiInstructorRole(null)).toBe(false);
    expect(isAiInstructorRole(undefined)).toBe(false);
  });
});

describe('LMS database routing', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.dontMock('pg');
  });

  it('uses DATABASE_URL even when a legacy LMS_POSTGRES_URL is present', async () => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://pooled.example/lms',
      LMS_POSTGRES_URL: 'postgresql://wrong.example/legacy',
    };
    const release = jest.fn();
    const connect = jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [{ id: 1 }] }),
      release,
    });
    const on = jest.fn();
    const Pool = jest.fn(() => ({ connect, on }));
    jest.doMock('pg', () => ({ Pool }));
    const { queryLMS } = await import('@/lib/lms-db');
    await expect(queryLMS('SELECT 1')).resolves.toEqual([{ id: 1 }]);
    await expect(queryLMS('SELECT 2', [2])).resolves.toEqual([{ id: 1 }]);
    expect(Pool).toHaveBeenCalledTimes(1);
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: 'postgresql://pooled.example/lms',
      ssl: { rejectUnauthorized: false },
      max: 2,
    }));
    expect(release).toHaveBeenCalledTimes(2);
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));
  });

  it('handles idle LMS pool errors without exposing the error or exiting', async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://pooled.example/lms',
    };
    const on = jest.fn();
    const Pool = jest.fn(() => ({
      connect: jest.fn().mockResolvedValue({
        query: jest.fn().mockResolvedValue({ rows: [] }),
        release: jest.fn(),
      }),
      on,
    }));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.doMock('pg', () => ({ Pool }));

    const { queryLMS } = await import('@/lib/lms-db');
    await queryLMS('SELECT 1');
    const errorListener = on.mock.calls.find(([event]) => event === 'error')?.[1];
    expect(errorListener).toEqual(expect.any(Function));

    errorListener(new Error('postgresql://user:secret@private-host/database'));
    expect(log).toHaveBeenCalledWith('Unexpected LMS database pool error');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('secret'));
    expect(exit).not.toHaveBeenCalled();

    log.mockRestore();
    exit.mockRestore();
  });

  it('fails fast when DATABASE_URL is absent', async () => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    process.env.LMS_POSTGRES_URL = 'postgresql://legacy.example/lms';
    const Pool = jest.fn();
    jest.doMock('pg', () => ({ Pool }));
    const { queryLMS } = await import('@/lib/lms-db');

    await expect(queryLMS('SELECT 1')).rejects.toThrow(
      'Missing DATABASE_URL environment variable'
    );
    expect(Pool).not.toHaveBeenCalled();
  });

  it.each(['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'TRUNCATE'])(
    'rejects %s statements before opening a database connection',
    async operation => {
      process.env = {
        ...originalEnv,
        DATABASE_URL: 'postgresql://pooled.example/lms',
      };
      const Pool = jest.fn();
      jest.doMock('pg', () => ({ Pool }));
      const { queryLMS } = await import('@/lib/lms-db');

      await expect(queryLMS(`${operation} example`)).rejects.toThrow(
        'Only SELECT queries are allowed'
      );
      expect(Pool).not.toHaveBeenCalled();
    }
  );

  it('releases the connection when a read query fails', async () => {
    process.env = {
      ...originalEnv,
      DATABASE_URL: 'postgresql://pooled.example/lms',
    };
    const release = jest.fn();
    const connect = jest.fn().mockResolvedValue({
      query: jest.fn().mockRejectedValue(new Error('read failed')),
      release,
    });
    const Pool = jest.fn(() => ({ connect, on: jest.fn() }));
    jest.doMock('pg', () => ({ Pool }));
    const { queryLMS } = await import('@/lib/lms-db');

    await expect(queryLMS('SELECT 1')).rejects.toThrow('read failed');
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe('auxiliary database routing', () => {
  const originalEnv = process.env;

  afterEach(() => {
    process.env = originalEnv;
    jest.resetModules();
    jest.dontMock('pg');
  });

  it('registers a safe idle error handler without exposing details or exiting', async () => {
    process.env = {
      ...originalEnv,
      AUX_POSTGRES_URL: 'postgresql://pooled.example/aux',
    };
    const release = jest.fn();
    const connect = jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release,
    });
    const on = jest.fn();
    const Pool = jest.fn(() => ({ connect, on }));
    const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const exit = jest.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    jest.doMock('pg', () => ({ Pool }));

    const { queryAux } = await import('@/lib/aux-db');
    await expect(queryAux('SELECT 1')).resolves.toEqual([]);
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ max: 2 }));
    expect(on).toHaveBeenCalledWith('error', expect.any(Function));

    const errorListener = on.mock.calls.find(([event]) => event === 'error')?.[1];
    errorListener(new Error('postgresql://user:secret@private-host/database'));
    expect(log).toHaveBeenCalledWith('Unexpected auxiliary database pool error');
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('secret'));
    expect(exit).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);

    log.mockRestore();
    exit.mockRestore();
  });
});

describe('authentication options', () => {
  const query = jest.fn();
  const verifyPassword = jest.fn();
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeAll(async () => {
    jest.resetModules();
    jest.doMock('@/lib/db', () => ({ __esModule: true, default: query }));
    jest.doMock('@/lib/hash', () => ({ verifyPassword }));
    jest.doMock('next-auth/providers/credentials', () => ({
      __esModule: true,
      default: (options: unknown) => options,
    }));
  });

  beforeEach(() => {
    query.mockReset();
    verifyPassword.mockReset();
    log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
    error.mockRestore();
  });

  afterAll(() => {
    jest.resetModules();
    jest.dontMock('@/lib/db');
    jest.dontMock('@/lib/hash');
    jest.dontMock('next-auth/providers/credentials');
  });

  const loadAuthorize = async () => {
    const { authOptions } = await import('../../auth');
    return { authOptions, authorize: (authOptions.providers[0] as any).authorize as Function };
  };

  it('rejects absent username or password before querying', async () => {
    const { authorize } = await loadAuthorize();
    await expect(authorize(undefined)).resolves.toBeNull();
    await expect(authorize({ username: '', password: 'x' })).resolves.toBeNull();
    await expect(authorize({ username: 'x', password: '' })).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects an unknown user', async () => {
    const { authorize } = await loadAuthorize();
    query.mockResolvedValueOnce([]);
    await expect(authorize({ username: 'missing', password: 'x' })).resolves.toBeNull();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  it('rejects an invalid password', async () => {
    const { authorize } = await loadAuthorize();
    query.mockResolvedValueOnce([{ id: 3, user_name: 'student', password: 'hash', nama_lengkap: 'Student', email: 's@example.test', role: 'SISWA' }]);
    verifyPassword.mockResolvedValue(false);
    await expect(authorize({ username: 'student', password: 'bad' })).resolves.toBeNull();
  });

  it('updates last login and returns a valid authenticated user', async () => {
    const { authorize } = await loadAuthorize();
    const user = { id: 3, user_name: 'teacher', password: 'hash', nama_lengkap: 'Teacher', email: 't@example.test', role: 'GURU' };
    query.mockResolvedValueOnce([user]).mockResolvedValueOnce([]);
    verifyPassword.mockResolvedValue(true);
    await expect(authorize({ username: 'teacher', password: 'correct' })).resolves.toEqual({
      id: '3', name: 'Teacher', email: 't@example.test', username: 'teacher', role: 'GURU',
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('fails closed on database or password errors', async () => {
    const { authorize } = await loadAuthorize();
    query.mockRejectedValueOnce(new Error('offline'));
    await expect(authorize({ username: 'teacher', password: 'x' })).resolves.toBeNull();
    expect(error).toHaveBeenCalled();
  });

  it('copies custom claims only when available and logs sign-out', async () => {
    const { authOptions } = await loadAuthorize();
    const jwt = authOptions.callbacks!.jwt! as Function;
    const sessionCallback = authOptions.callbacks!.session! as Function;
    const token = { sub: '9' } as any;
    await expect(jwt({ token, user: undefined })).resolves.toBe(token);
    await expect(jwt({ token, user: { username: 'demo', role: 'ADMIN' } })).resolves.toMatchObject({ username: 'demo', role: 'ADMIN' });

    const session = { user: {} } as any;
    await expect(sessionCallback({ session, token: null })).resolves.toBe(session);
    await expect(sessionCallback({ session, token: {} })).resolves.toBe(session);
    await expect(sessionCallback({ session, token: { sub: undefined, username: 'demo', role: 'ADMIN' } })).resolves.toMatchObject({
      user: { id: '', username: 'demo', role: 'ADMIN' },
    });
    await (authOptions.events!.signOut as Function)({ token: { sub: '9' } });
    await (authOptions.events!.signOut as Function)({ token: null });
    expect(log).toHaveBeenCalledWith('User signed out:', '9');
  });
});

describe('request middleware', () => {
  const getToken = jest.fn();
  const next = jest.fn(() => ({ type: 'next' }));
  const redirect = jest.fn((url: URL) => ({
    type: 'redirect', url: url.toString(), cookies: { delete: jest.fn() },
  }));

  beforeAll(() => {
    jest.resetModules();
    jest.doMock('next-auth/jwt', () => ({ getToken }));
    jest.doMock('next/server', () => ({ NextResponse: { next, redirect } }));
  });

  beforeEach(() => {
    getToken.mockReset();
    next.mockClear();
    redirect.mockClear();
  });

  afterAll(() => {
    jest.resetModules();
    jest.dontMock('next-auth/jwt');
    jest.dontMock('next/server');
  });

  const request = (pathname: string) => ({ nextUrl: { pathname }, url: `https://lms.example${pathname}` }) as any;

  it('exempts only the cron reset endpoint before token lookup', async () => {
    const { proxy } = await import('../../proxy');
    await expect(proxy(request('/api/cron/reset'))).resolves.toEqual({ type: 'next' });
    expect(getToken).not.toHaveBeenCalled();
  });

  it.each(['/api/auth/signin', '/_next/static/a.js', '/favicon.ico', '/images/logo.png', '/icons/x.svg', '/file.svg'])
  ('allows infrastructure/public asset path %s', async pathname => {
    const { proxy } = await import('../../proxy');
    getToken.mockResolvedValue(null);
    await expect(proxy(request(pathname))).resolves.toEqual({ type: 'next' });
  });

  it('redirects an expired token and deletes all session cookies', async () => {
    const { proxy } = await import('../../proxy');
    getToken.mockResolvedValue({ exp: 1 });
    const response = await proxy(request('/course')) as any;
    expect(response.url).toBe('https://lms.example/login');
    expect(response.cookies.delete).toHaveBeenCalledTimes(4);
  });

  it('redirects authenticated users away from each public route', async () => {
    const { proxy } = await import('../../proxy');
    getToken.mockResolvedValue({ exp: Math.floor(Date.now() / 1000) + 60 });
    await expect(proxy(request('/login'))).resolves.toMatchObject({ url: 'https://lms.example/dashboard' });
    await expect(proxy(request('/auth/help'))).resolves.toMatchObject({ url: 'https://lms.example/dashboard' });
  });

  it('allows authenticated private paths with missing or valid expiry', async () => {
    const { proxy } = await import('../../proxy');
    getToken.mockResolvedValue({});
    await expect(proxy(request('/course'))).resolves.toEqual({ type: 'next' });
    getToken.mockResolvedValue({ exp: Math.floor(Date.now() / 1000) + 60 });
    await expect(proxy(request('/course'))).resolves.toEqual({ type: 'next' });
  });

  it('redirects unauthenticated private paths with a callback and allows public paths', async () => {
    const { proxy } = await import('../../proxy');
    getToken.mockResolvedValue(null);
    await expect(proxy(request('/course/ABC'))).resolves.toMatchObject({
      url: 'https://lms.example/login?callbackUrl=%2Fcourse%2FABC',
    });
    await expect(proxy(request('/login'))).resolves.toEqual({ type: 'next' });
    await expect(proxy(request('/auth/help'))).resolves.toEqual({ type: 'next' });
  });

  it.each(['/login-private', '/authorization'])
  ('requires authentication for routes that only share a public-route prefix: %s', async pathname => {
    const { proxy } = await import('../../proxy');
    getToken.mockResolvedValue(null);

    await expect(proxy(request(pathname))).resolves.toMatchObject({
      url: `https://lms.example/login?callbackUrl=${encodeURIComponent(pathname)}`,
    });
  });
});
