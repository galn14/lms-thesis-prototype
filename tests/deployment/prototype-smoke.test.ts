const { signIn, productionSmokeTest } = require('../../scripts/prototype/smoke.cjs');

const passwordName = 'DEMO_SHARED' + '_PASSWORD';
const cronName = 'CRON' + '_SECRET';
const passwordEnvironment = (value: string) => ({ [passwordName]: value, [cronName]: 'cron-secret-for-tests' });
const headers = (cookies?: string[]) => ({ getSetCookie: cookies ? () => cookies : undefined });
type SmokeRequestOptions = { method?: string; headers: Record<string, string> };
const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300, status, json: async () => body, headers: headers(),
});

function authenticatedResponses() {
  const responses: Array<Record<string, unknown>> = [{ ok: true, status: 200 }];
  for (const role of ['admin', 'teacher', 'student']) {
    responses.push(
      { ok: true, status: 200, json: async () => ({ csrfToken: `csrf-${role}` }), headers: headers([`csrf-${role}=value; Path=/`]) },
      { ok: true, status: 200, headers: headers([`__Secure-next-auth.session-token=${role}-session; Path=/`]) },
    );
  }
  return responses;
}

/**
 * The full request queue of a healthy production run, in order:
 *  0 login page, 1-6 the three credential sign-ins, 7 admin read, 8-9 teacher
 *  and student reads, 10 grading, 11 plagiarism results, 12-15 risk coverage,
 *  16 the authenticated 503 guard, 17-23 the reversible material CRUD,
 *  24 reset sentinel, 25-26 cron authorization and reset, 27 restoration.
 */
const happyPathResponses = (): Array<Record<string, unknown>> => [
  ...authenticatedResponses(),
  jsonResponse(200, { success: true, data: { users: [{ user_name: 'demo_admin' }] } }),
  jsonResponse(200, { success: true, data: [{ assignment_id: 1 }] }),
  jsonResponse(200, { success: true, data: [{ assignment_id: 1 }] }),
  jsonResponse(200, { success: true, data: { job: { assignment_id: '1' }, results: [{ student_id: '5' }] } }),
  jsonResponse(200, [{ submission_id: '1', high_risk_count: 1, medium_risk_count: 0, low_risk_count: 0 }]),
  jsonResponse(200, { matches: [{ risk_level: 'HIGH' }] }),
  jsonResponse(200, { matches: [{ risk_level: 'MEDIUM' }] }),
  jsonResponse(200, { matches: [{ risk_level: 'LOW' }] }),
  jsonResponse(200, { matches: [{ risk_level: 'NONE' }] }),
  jsonResponse(503, { success: false, code: 'PROTOTYPE_EXTERNAL_PROCESSING_DISABLED' }),
  jsonResponse(200, { success: true, data: [{ id: 1, title: 'Ringkasan Materi 1' }] }),
  jsonResponse(200, { success: true, data: { id: 99, title: 'Smoke test material' } }),
  jsonResponse(200, { success: true, data: [{ id: 1 }, { id: 99, title: 'Smoke test material' }] }),
  jsonResponse(200, { success: true, data: { id: 99, title: 'Smoke test material updated' } }),
  jsonResponse(200, { success: true, data: [{ id: 99, title: 'Smoke test material updated' }] }),
  jsonResponse(200, { success: true }),
  jsonResponse(200, { success: true, data: [{ id: 1, title: 'Ringkasan Materi 1' }] }),
  jsonResponse(200, { success: true, data: { id: 1, title: 'Smoke reset sentinel' } }),
  jsonResponse(401, { success: false, code: 'UNAUTHORIZED' }),
  jsonResponse(200, { success: true }),
  jsonResponse(200, { success: true, data: [{ id: 1, title: 'Ringkasan Materi 1' }] }),
];

const withOverrides = (overrides: Record<number, Record<string, unknown>>) => {
  const responses = happyPathResponses();
  for (const [index, response] of Object.entries(overrides)) responses[Number(index)] = response;
  return responses;
};

describe('production smoke tests', () => {
  test('performs a credential sign-in without logging or returning the password', async () => {
    const request = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf' }), headers: headers(['csrf=value; Path=/']) })
      .mockResolvedValueOnce({ ok: true, headers: headers(['next-auth.session-token=session; Path=/']) });
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(signIn('https://prototype.test', 'demo_teacher', 'private-password', request)).resolves.toBe(true);
    expect(request.mock.calls[1][1].body.toString()).toContain('username=demo_teacher');
    expect(request.mock.calls[1][1].headers.Cookie).toBe('csrf=value');
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    log.mockRestore();
    error.mockRestore();
  });

  test('fails sign-in for an unavailable CSRF endpoint or absent session cookie', async () => {
    await expect(signIn('https://prototype.test', 'demo_teacher', 'x', async () => ({ ok: false }))).resolves.toBe(false);
    const request = jest.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ csrfToken: 'csrf' }), headers: headers() })
      .mockResolvedValueOnce({ ok: false, headers: headers() });
    await expect(signIn('https://prototype.test', 'demo_teacher', 'x', request)).resolves.toBe(false);
  });

  test('checks authenticated reads, prepared results, reversible CRUD, guards, reset, and restoration', async () => {
    const responses = authenticatedResponses();
    responses.push(
      jsonResponse(200, { success: true, data: { users: [{ user_name: 'demo_admin' }] } }),
      jsonResponse(200, { success: true, data: [{ assignment_id: 1 }] }),
      jsonResponse(200, { success: true, data: [{ assignment_id: 1 }] }),
      jsonResponse(200, { success: true, data: { job: { assignment_id: '1' }, results: [{ student_id: '5' }] } }),
      jsonResponse(200, [{ submission_id: '1', high_risk_count: 1, medium_risk_count: 0, low_risk_count: 0 }]),
      jsonResponse(200, { matches: [{ risk_level: 'HIGH' }] }),
      jsonResponse(200, { matches: [{ risk_level: 'MEDIUM' }] }),
      jsonResponse(200, { matches: [{ risk_level: 'LOW' }] }),
      jsonResponse(200, { matches: [{ risk_level: 'NONE' }] }),
      jsonResponse(503, { success: false, code: 'PROTOTYPE_EXTERNAL_PROCESSING_DISABLED' }),
      jsonResponse(200, { success: true, data: [{ id: 1, title: 'Ringkasan Materi 1' }] }),
      jsonResponse(200, { success: true, data: { id: 99, title: 'Smoke test material' } }),
      jsonResponse(200, { success: true, data: [{ id: 1 }, { id: 99, title: 'Smoke test material' }] }),
      jsonResponse(200, { success: true, data: { id: 99, title: 'Smoke test material updated' } }),
      jsonResponse(200, { success: true, data: [{ id: 99, title: 'Smoke test material updated' }] }),
      jsonResponse(200, { success: true }),
      jsonResponse(200, { success: true, data: [{ id: 1, title: 'Ringkasan Materi 1' }] }),
      jsonResponse(200, { success: true, data: { id: 1, title: 'Smoke reset sentinel' } }),
      jsonResponse(401, { success: false, code: 'UNAUTHORIZED' }),
      jsonResponse(200, { success: true }),
      jsonResponse(200, { success: true, data: [{ id: 1, title: 'Ringkasan Materi 1' }] }),
    );
    const request = jest.fn(async (_url: string, _options: SmokeRequestOptions) => responses.shift());

    await expect(productionSmokeTest(
      { url: 'prototype.test' }, passwordEnvironment('shared-password-for-tests'), request,
    )).resolves.toEqual({ healthy: true });

    const calls = request.mock.calls;
    expect(calls.some(([url, options]) => url.endsWith('/api/admin/users') && options.headers.Cookie.includes('admin-session'))).toBe(true);
    expect(calls.some(([url, options]) => url.endsWith('/api/scores') && options.headers.Cookie.includes('teacher-session'))).toBe(true);
    expect(calls.some(([url, options]) => url.endsWith('/api/scores') && options.headers.Cookie.includes('student-session'))).toBe(true);
    expect(calls.some(([url]) => url.endsWith('/api/ai-grading/results/1?studentId=5'))).toBe(true);
    expect(calls.filter(([url]) => url.includes('/api/plagiarism/similarities/'))).toHaveLength(4);
    expect(calls.some(([url, options]) => url.endsWith('/api/ai-grading/run-all') && options.method === 'POST')).toBe(true);
    expect(calls.some(([url, options]) => url.endsWith('/api/cron/reset') && options.headers.Authorization === 'Bearer intentionally-wrong')).toBe(true);
    expect(calls.some(([url, options]) => url.endsWith('/api/cron/reset') && options.headers.Authorization === 'Bearer cron-secret-for-tests')).toBe(true);
  });

  test.each([
    ['login page', [{ ok: false }], 'Production login page is unavailable'],
    ['admin role login', [{ ok: true }, { ok: false }], 'Production login smoke test failed for demo_admin'],
  ])('reports %s failure', async (_label, queue, expectedError) => {
    const responses = [...queue];
    await expect(productionSmokeTest(
      { url: 'https://prototype.test' }, passwordEnvironment('x'), async () => responses.shift(),
    )).resolves.toEqual({ healthy: false, error: expectedError });
  });

  test.each([
    ['admin read', { 7: jsonResponse(200, { success: true, data: {} }) }, 'Production admin read smoke test failed'],
    ['teacher read', { 8: jsonResponse(200, { success: true, data: [] }) }, 'Production teacher read smoke test failed'],
    ['student read', { 9: jsonResponse(200, { success: true, data: [] }) }, 'Production student read smoke test failed'],
    ['prepared grading results', { 10: jsonResponse(200, { success: true, data: { job: null, results: [] } }) }, 'Production prepared grading results smoke test failed'],
    ['prepared plagiarism results', { 11: jsonResponse(200, []) }, 'Production prepared plagiarism results smoke test failed'],
    ['plagiarism response shape', { 12: jsonResponse(200, { matches: 'not-an-array' }) }, 'Production plagiarism risk coverage smoke test failed'],
    ['incomplete risk coverage', {
      13: jsonResponse(200, { matches: [{ risk_level: 'HIGH' }] }),
      14: jsonResponse(200, { matches: [{ risk_level: 'HIGH' }] }),
      15: jsonResponse(200, { matches: [{ risk_level: 'HIGH' }] }),
    }, 'Production plagiarism risk coverage smoke test failed'],
    ['material baseline', { 17: jsonResponse(200, { success: true, data: [{ id: 1, title: 'Renamed' }] }) }, 'Production material baseline smoke test failed'],
    ['dummy create', { 18: jsonResponse(200, { success: true, data: {} }) }, 'Production dummy create smoke test failed'],
    ['dummy read', { 19: jsonResponse(200, { success: true, data: [{ id: 1 }] }) }, 'Production dummy read smoke test failed'],
    ['dummy update', { 20: jsonResponse(200, { success: true, data: { id: 99, title: 'Stale' } }) }, 'Production dummy update smoke test failed'],
    ['dummy updated read', { 21: jsonResponse(200, { success: true, data: [{ id: 99, title: 'Stale' }] }) }, 'Production dummy updated-read smoke test failed'],
    ['dummy delete', { 22: jsonResponse(500, { success: false }) }, 'Production dummy delete smoke test failed'],
    ['dummy deletion verification', { 23: jsonResponse(200, { success: true, data: [{ id: 99 }] }) }, 'Production dummy deletion verification failed'],
    ['reset sentinel', { 24: jsonResponse(500, { success: false }) }, 'Production reset sentinel smoke test failed'],
    ['cron authorization', { 25: jsonResponse(200, { success: true }) }, 'Production cron authorization smoke test failed'],
    ['manual reset', { 26: jsonResponse(500, { success: false }) }, 'Production reset smoke test failed'],
    ['post-reset restoration', { 27: jsonResponse(200, { success: true, data: [{ id: 1, title: 'Smoke reset sentinel' }] }) }, 'Production post-reset restoration smoke test failed'],
  ])('reports an exact %s failure', async (_label, overrides, expectedError) => {
    const responses = withOverrides(overrides as Record<number, Record<string, unknown>>);
    await expect(productionSmokeTest(
      { url: 'https://prototype.test' }, passwordEnvironment('x'), async () => responses.shift(),
    )).resolves.toEqual({ healthy: false, error: expectedError });
  });

  test('treats an unreadable JSON body as a failed check', async () => {
    const responses = withOverrides({
      7: { ok: true, status: 200, json: async () => { throw new Error('invalid body'); }, headers: headers() },
    });
    await expect(productionSmokeTest(
      { url: 'https://prototype.test' }, passwordEnvironment('x'), async () => responses.shift(),
    )).resolves.toEqual({ healthy: false, error: 'Production admin read smoke test failed' });
  });

  test('reports a transport failure without logging the shared password', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(productionSmokeTest(
      { url: 'https://prototype.test' },
      passwordEnvironment('shared-password-for-tests'),
      async () => { throw new Error('network unreachable'); },
    )).resolves.toEqual({ healthy: false, error: 'Production smoke test request failed' });
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  test('reports an exact authenticated prototype-guard failure', async () => {
    const responses = authenticatedResponses();
    responses.push(
      jsonResponse(200, { success: true, data: { users: [] } }),
      jsonResponse(200, { success: true, data: [{ assignment_id: 1 }] }),
      jsonResponse(200, { success: true, data: [{ assignment_id: 1 }] }),
      jsonResponse(200, { success: true, data: { job: {}, results: [{}] } }),
      jsonResponse(200, [{}]),
      jsonResponse(200, { matches: [{ risk_level: 'HIGH' }] }),
      jsonResponse(200, { matches: [{ risk_level: 'MEDIUM' }] }),
      jsonResponse(200, { matches: [{ risk_level: 'LOW' }] }),
      jsonResponse(200, { matches: [{ risk_level: 'NONE' }] }),
      jsonResponse(503, { success: false, code: 'WRONG_CODE' }),
    );
    await expect(productionSmokeTest(
      { url: 'https://prototype.test' }, passwordEnvironment('x'), async () => responses.shift(),
    )).resolves.toEqual({ healthy: false, error: 'Production authenticated 503 guard smoke test failed' });
  });
});

export {};
