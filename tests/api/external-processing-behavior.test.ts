import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { requireAdmin } from '@/lib/auth/require-admin';
import { prisma } from '@/lib/prisma';
import { canUseFeature } from '@/lib/feature-access';
import {
  archiveAcsAssignment,
  createGradingJob,
  getAcsAssignmentByAssignmentId,
  getUploadedFilesByAssignmentId,
  getUploadedFilesByResourceIds,
  insertUploadedFiles,
  updateGradingJobStatus,
  upsertAcsAssignment,
} from '@/lib/db2/acs-repo';
import { deleteCredential, getCredential, upsertCredential } from '@/lib/db2/admin-repo';
import { encryptSecret, maskSecret } from '@/lib/crypto';
import { logAudit } from '@/lib/audit';
import { getOpenAI, resetOpenAICache } from '@/lib/openai';
import { gradeStudentAnswer } from '@/lib/grading-service';
import { initDetection, processDetection } from '@/lib/plagiarism/detection';
import { OpenAI } from 'openai';
import fs from 'fs';
import { GET as getCredentialRoute, PUT as putCredentialRoute, DELETE as deleteCredentialRoute } from '@/app/api/admin/credentials/route';
import { POST as runAll } from '@/app/api/ai-grading/run-all/route';
import { POST as runSingle } from '@/app/api/ai-grading/run-single/route';
import { POST as detectPlagiarism } from '@/app/api/plagiarism/detect/route';
import { POST as checkFiles } from '@/app/api/assignments/check-files/route';
import { POST as cleanup } from '@/app/api/assignments/cleanup/route';
import { POST as createSetup } from '@/app/api/assignments/create/route';
import { POST as uploadSetupFile } from '@/app/api/assignments/upload-files/route';

const mockProvider = {
  files: {
    create: jest.fn(),
    retrieve: jest.fn(),
    delete: jest.fn(),
  },
  vectorStores: {
    create: jest.fn(),
    delete: jest.fn(),
    fileBatches: { createAndPoll: jest.fn() },
    files: { create: jest.fn() },
  },
};

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth/require-admin', () => ({ requireAdmin: jest.fn() }));
jest.mock('@/lib/feature-access', () => ({ canUseFeature: jest.fn() }));
jest.mock('@/lib/db2/acs-repo', () => ({
  archiveAcsAssignment: jest.fn(),
  createGradingJob: jest.fn(),
  getAcsAssignmentByAssignmentId: jest.fn(),
  getUploadedFilesByAssignmentId: jest.fn(),
  getUploadedFilesByResourceIds: jest.fn(),
  insertUploadedFiles: jest.fn(),
  updateGradingJobStatus: jest.fn(),
  upsertAcsAssignment: jest.fn(),
}));
jest.mock('@/lib/db2/admin-repo', () => ({
  deleteCredential: jest.fn(),
  getCredential: jest.fn(),
  upsertCredential: jest.fn(),
}));
jest.mock('@/lib/crypto', () => ({ encryptSecret: jest.fn(), maskSecret: jest.fn() }));
jest.mock('@/lib/audit', () => ({ logAudit: jest.fn() }));
jest.mock('@/lib/openai', () => ({ getOpenAI: jest.fn(), resetOpenAICache: jest.fn() }));
jest.mock('@/lib/grading-service', () => ({ gradeStudentAnswer: jest.fn() }));
jest.mock('@/lib/plagiarism/detection', () => ({ initDetection: jest.fn(), processDetection: jest.fn() }));
jest.mock('openai', () => ({ OpenAI: jest.fn(() => mockProvider) }));
jest.mock('fs', () => ({
  __esModule: true,
  default: {
    existsSync: jest.fn(),
    createReadStream: jest.fn(),
    promises: { writeFile: jest.fn(), unlink: jest.fn() },
  },
}));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    app_user: { findUnique: jest.fn() },
    assignments: { findUnique: jest.fn() },
    assignment_submissions: { findMany: jest.fn() },
    resources: { findMany: jest.fn() },
  },
}));

const mockSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockAccess = canUseFeature as jest.MockedFunction<typeof canUseFeature>;
const mockAcs = getAcsAssignmentByAssignmentId as jest.Mock;
const mockUploadedByAssignment = getUploadedFilesByAssignmentId as jest.MockedFunction<typeof getUploadedFilesByAssignmentId>;
const mockUploadedByResource = getUploadedFilesByResourceIds as jest.MockedFunction<typeof getUploadedFilesByResourceIds>;
const mockGetOpenAI = getOpenAI as jest.MockedFunction<typeof getOpenAI>;
const mockFindUser = prisma.app_user.findUnique as jest.Mock;
const mockFindAssignment = prisma.assignments.findUnique as jest.Mock;
const mockFindSubmissions = prisma.assignment_submissions.findMany as jest.Mock;
const mockFindResources = prisma.resources.findMany as jest.Mock;
const mockExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;

const teacherSession = {
  user: { id: '2', name: 'Demo Teacher', email: 'teacher@example.test', role: 'TEACHER' },
  expires: '2099-01-01T00:00:00.000Z',
};

function jsonRequest(path: string, body: unknown, method = 'POST') {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function invalidJsonRequest(path: string, method = 'POST') {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: '{',
  });
}

function instructorRecord(role = 'TEACHER', active = true) {
  return { app_user_role: [{ enumeration: { name: role }, is_active: active }] };
}

async function flushBackgroundWork() {
  await new Promise<void>(resolve => setImmediate(resolve));
  await new Promise<void>(resolve => setImmediate(resolve));
}

describe('provider credential routes outside prototype mode', () => {
  const originalKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'false';
    delete process.env.OPENAI_API_KEY;
    mockAdmin.mockResolvedValue({ ok: true, user: { id: '1', name: 'Demo Admin' } } as never);
    (maskSecret as jest.Mock).mockImplementation((value: string) => `masked:${value.slice(-4)}`);
    (encryptSecret as jest.Mock).mockReturnValue('encrypted');
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('reports a stored credential without reading the environment fallback', async () => {
    (getCredential as jest.Mock).mockResolvedValue({
      key_hint: 'sk-...demo',
      updated_by: '1',
      updated_at: '2026-01-01T00:00:00.000Z',
    });

    const response = await getCredentialRoute();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { configured: true, source: 'database', key_hint: 'sk-...demo' },
    });
  });

  it('returns the authentication response when credential reading is not authorized', async () => {
    mockAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    } as never);

    const response = await getCredentialRoute();

    expect(response.status).toBe(401);
    expect(getCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['environment', 'environment-secret', true, 'env'],
    ['no', undefined, false, 'none'],
  ])('reports the %s credential fallback', async (_label, key, configured, source) => {
    (getCredential as jest.Mock).mockResolvedValue(null);
    if (key) process.env.OPENAI_API_KEY = key;
    else delete process.env.OPENAI_API_KEY;

    const response = await getCredentialRoute();
    const payload = await response.json();

    expect(payload.data).toMatchObject({ configured, source });
    expect(payload.data.key_hint).toBe(key ? 'masked:cret' : null);
  });

  it('rejects malformed JSON and short keys', async () => {
    const malformed = await putCredentialRoute(invalidJsonRequest('/api/admin/credentials', 'PUT'));
    const short = await putCredentialRoute(jsonRequest('/api/admin/credentials', { apiKey: ' short ' }, 'PUT'));
    const wrongType = await putCredentialRoute(jsonRequest('/api/admin/credentials', { apiKey: 7 }, 'PUT'));
    const nullBody = await putCredentialRoute(jsonRequest('/api/admin/credentials', null, 'PUT'));

    expect(malformed.status).toBe(400);
    expect(short.status).toBe(400);
    expect(wrongType.status).toBe(400);
    expect(nullBody.status).toBe(400);
    expect(upsertCredential).not.toHaveBeenCalled();
  });

  it('stores a trimmed key, clears the cache, and records an audit event', async () => {
    const response = await putCredentialRoute(
      jsonRequest('/api/admin/credentials', { apiKey: '  valid-provider-key  ' }, 'PUT')
    );

    expect(response.status).toBe(200);
    expect(upsertCredential).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      encrypted_key: 'encrypted',
      updated_by: '1',
    }));
    expect(resetOpenAICache).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential.updated' }));
  });

  it('deletes the credential and records the reset', async () => {
    const response = await deleteCredentialRoute();

    expect(response.status).toBe(200);
    expect(deleteCredential).toHaveBeenCalledWith('openai');
    expect(resetOpenAICache).toHaveBeenCalledTimes(1);
    expect(logAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'credential.reset' }));
  });
});

describe('grading and detection routes outside prototype mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'false';
    mockSession.mockResolvedValue(teacherSession);
    mockAccess.mockResolvedValue({ allowed: true });
    mockAcs.mockResolvedValue({
      course_id: '11',
      rubric: [{ questionId: '7', criteria: [] }],
      vector_store_id: 'vs-1',
    } as never);
    mockGetOpenAI.mockResolvedValue(mockProvider as never);
    mockProvider.vectorStores.delete.mockResolvedValue({});
    mockProvider.files.delete.mockResolvedValue({});
    mockProvider.files.retrieve.mockResolvedValue({ id: 'file-old' });
    (gradeStudentAnswer as jest.Mock).mockResolvedValue({ score: 88 });
    (createGradingJob as jest.Mock).mockResolvedValue({ id: 'job-1' });
    (updateGradingJobStatus as jest.Mock).mockResolvedValue(undefined);
    (initDetection as jest.Mock).mockResolvedValue('detection-1');
    (processDetection as jest.Mock).mockResolvedValue(undefined);
  });

  it('validates malformed single-grading JSON before loading configuration', async () => {
    const response = await runSingle(invalidJsonRequest('/api/ai-grading/run-single'));

    expect(response.status).toBe(400);
    expect(mockAcs).not.toHaveBeenCalled();
  });

  it('reports missing configuration, denied feature access, and a missing rubric', async () => {
    mockAcs.mockResolvedValueOnce(null);
    const missingConfig = await runSingle(jsonRequest('/api/ai-grading/run-single', {}));

    mockAccess.mockResolvedValueOnce({ allowed: false, reason: 'Feature disabled' });
    const denied = await runSingle(jsonRequest('/api/ai-grading/run-single', { assignmentId: '1' }));

    mockAcs.mockResolvedValueOnce({ course_id: '11', rubric: [], vector_store_id: 'vs-1' } as never);
    const missingRubric = await runSingle(jsonRequest('/api/ai-grading/run-single', {
      assignmentId: '1', studentId: '2', questionId: '99', studentAnswer: 'Answer',
    }));

    expect(missingConfig.status).toBe(404);
    expect(denied.status).toBe(403);
    expect(missingRubric.status).toBe(400);
  });

  it('reports a missing scalar rubric and supports an unnamed instructor', async () => {
    mockSession.mockResolvedValue({ ...teacherSession, user: { ...teacherSession.user, name: undefined } });
    mockAcs.mockResolvedValue({ course_id: '11', rubric: null, vector_store_id: 'vs-1' } as never);

    const missingRubric = await runSingle(jsonRequest('/api/ai-grading/run-single', {
      assignmentId: '1', studentId: '2', questionId: '7', studentAnswer: 'Answer',
    }));

    expect(missingRubric.status).toBe(400);

    mockAcs.mockResolvedValue({ course_id: '11', rubric: { criteria: [] }, vector_store_id: 'vs-1' } as never);
    const graded = await runSingle(jsonRequest('/api/ai-grading/run-single', {
      assignmentId: '1', studentId: '2', questionId: '7', studentAnswer: 'Answer',
    }));
    expect(graded.status).toBe(200);
    expect(gradeStudentAnswer).toHaveBeenCalledWith(expect.objectContaining({ teacherName: undefined }));
  });

  it.each([
    ['an array rubric', [{ questionId: 7, criteria: ['clarity'] }]],
    ['an object rubric', { criteria: ['accuracy'] }],
  ])('grades with %s', async (_label, rubric) => {
    mockAcs.mockResolvedValue({ course_id: '11', rubric, vector_store_id: 'vs-1' } as never);

    const response = await runSingle(jsonRequest('/api/ai-grading/run-single', {
      assignmentId: '1', studentId: '2', questionId: '7', studentAnswer: 'Answer',
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: { score: 88 } });
    expect(gradeStudentAnswer).toHaveBeenCalledWith(expect.objectContaining({
      questionId: '7', teacherId: '2', teacherName: 'Demo Teacher',
    }));
  });

  it('returns a safe server error when single grading fails', async () => {
    (gradeStudentAnswer as jest.Mock).mockRejectedValue(new Error('grading unavailable'));

    const response = await runSingle(jsonRequest('/api/ai-grading/run-single', {
      assignmentId: '1', studentId: '2', questionId: '7', studentAnswer: 'Answer',
    }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'grading unavailable' });
  });

  it('validates mass-grading input, configuration, feature access, and submissions', async () => {
    expect((await runAll(invalidJsonRequest('/api/ai-grading/run-all'))).status).toBe(400);

    mockAcs.mockResolvedValueOnce(null);
    expect((await runAll(jsonRequest('/api/ai-grading/run-all', { assignmentId: '1' }))).status).toBe(404);

    mockAccess.mockResolvedValueOnce({ allowed: false, reason: 'Feature disabled' });
    expect((await runAll(jsonRequest('/api/ai-grading/run-all', { assignmentId: '1' }))).status).toBe(403);

    mockFindSubmissions.mockResolvedValueOnce([]);
    const empty = await runAll(jsonRequest('/api/ai-grading/run-all', { assignmentId: '1' }));
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({ success: false, message: 'No submissions found to grade' });
  });

  it('grades eligible answers, skips incomplete rubric data, completes the job, and deletes the vector store', async () => {
    mockFindSubmissions.mockResolvedValue([
      {
        student_id: 4,
        assignment_answers: [
          { question_id: 7, answer_text: 'Eligible' },
          { question_id: 8, answer_text: 'No rubric' },
          { question_id: 7, answer_text: '' },
        ],
      },
    ]);

    const response = await runAll(jsonRequest('/api/ai-grading/run-all', { assignmentId: '1' }));
    expect(response.status).toBe(200);
    await flushBackgroundWork();

    expect(gradeStudentAnswer).toHaveBeenCalledTimes(1);
    expect(updateGradingJobStatus).toHaveBeenCalledWith('job-1', 'completed', expect.any(String));
    expect(mockProvider.vectorStores.delete).toHaveBeenCalledWith('vs-1');
  });

  it('supports an object rubric and marks a failed background job without surfacing it to the request', async () => {
    mockSession.mockResolvedValue({ ...teacherSession, user: { ...teacherSession.user, name: undefined } });
    mockAcs.mockResolvedValue({ course_id: '11', rubric: { criteria: [] }, vector_store_id: 'vs-1' } as never);
    mockFindSubmissions.mockResolvedValue([{ student_id: 4, assignment_answers: [{ question_id: 7, answer_text: 'Answer' }] }]);
    (gradeStudentAnswer as jest.Mock).mockRejectedValue(new Error('background failed'));
    mockProvider.vectorStores.delete.mockRejectedValue({ status: 500, message: 'delete failed' });

    const response = await runAll(jsonRequest('/api/ai-grading/run-all', { assignmentId: '1' }));
    expect(response.status).toBe(200);
    await flushBackgroundWork();

    expect(updateGradingJobStatus).toHaveBeenCalledWith('job-1', 'failed');
  });

  it('ignores a missing vector store while completing mass grading cleanup', async () => {
    mockFindSubmissions.mockResolvedValue([{ student_id: 4, assignment_answers: [] }]);
    mockProvider.vectorStores.delete.mockRejectedValue({ status: 404, message: 'not found' });

    expect((await runAll(jsonRequest('/api/ai-grading/run-all', { assignmentId: '1' }))).status).toBe(200);
    await flushBackgroundWork();

    expect(updateGradingJobStatus).toHaveBeenCalledWith('job-1', 'completed', expect.any(String));
  });

  it('skips answers when a mass-grading rubric is absent and supports an unnamed instructor', async () => {
    mockSession.mockResolvedValue({ ...teacherSession, user: { ...teacherSession.user, name: undefined } });
    mockAcs.mockResolvedValue({ course_id: '11', rubric: null, vector_store_id: 'vs-1' } as never);
    mockFindSubmissions.mockResolvedValue([{ student_id: 4, assignment_answers: [{ question_id: 7, answer_text: 'Answer' }] }]);

    expect((await runAll(jsonRequest('/api/ai-grading/run-all', { assignmentId: '1' }))).status).toBe(200);
    await flushBackgroundWork();

    expect(gradeStudentAnswer).not.toHaveBeenCalled();
  });

  it('returns a server error when mass-grading setup fails', async () => {
    mockAcs.mockRejectedValue(new Error('database unavailable'));

    const response = await runAll(jsonRequest('/api/ai-grading/run-all', { assignmentId: '1' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: 'database unavailable' });
  });

  it('validates plagiarism detection JSON and assignment input', async () => {
    expect((await detectPlagiarism(invalidJsonRequest('/api/plagiarism/detect'))).status).toBe(400);
    expect((await detectPlagiarism(jsonRequest('/api/plagiarism/detect', {}))).status).toBe(400);
  });

  it('requires a teacher assignment to resolve to a plagiarism-enabled course', async () => {
    mockFindAssignment.mockResolvedValueOnce(null);
    const unresolved = await detectPlagiarism(jsonRequest('/api/plagiarism/detect', { assignmentId: '1' }));

    mockFindAssignment.mockResolvedValueOnce({ sessions: { class_courses: { course_id: 11 } } });
    mockAccess.mockResolvedValueOnce({ allowed: false, reason: 'Feature disabled' });
    const denied = await detectPlagiarism(jsonRequest('/api/plagiarism/detect', { assignmentId: '1' }));

    expect(unresolved.status).toBe(400);
    expect(denied.status).toBe(403);
  });

  it.each([
    ['teacher', teacherSession, ['7', '8']],
    ['admin', { ...teacherSession, user: { ...teacherSession.user, role: 'admin' } }, undefined],
  ])('starts detection for an authenticated %s', async (_label, session, questionIds) => {
    mockSession.mockResolvedValue(session);
    mockFindAssignment.mockResolvedValue({ sessions: { class_courses: { course_id: 11 } } });
    (processDetection as jest.Mock).mockRejectedValue(new Error('asynchronous failure'));

    const response = await detectPlagiarism(jsonRequest('/api/plagiarism/detect', { assignmentId: '1', questionIds }));
    await flushBackgroundWork();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ detectionId: 'detection-1' });
    expect(initDetection).toHaveBeenCalledWith('1', '2', questionIds ?? []);
    if (_label === 'admin') expect(mockFindAssignment).not.toHaveBeenCalled();
  });

  it('returns a safe server error when detection initialization fails', async () => {
    mockFindAssignment.mockResolvedValue({ sessions: { class_courses: { course_id: 11 } } });
    (initDetection as jest.Mock).mockRejectedValue(new Error('initialization failed'));

    const response = await detectPlagiarism(jsonRequest('/api/plagiarism/detect', { assignmentId: '1' }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal Server Error', details: 'initialization failed' });
  });

  it('rejects a session whose role is absent', async () => {
    mockSession.mockResolvedValue({ ...teacherSession, user: { ...teacherSession.user, role: undefined } });

    const response = await detectPlagiarism(jsonRequest('/api/plagiarism/detect', { assignmentId: '1' }));

    expect(response.status).toBe(403);
  });
});

describe('grading material management outside prototype mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'false';
    mockSession.mockResolvedValue(teacherSession);
    mockFindUser.mockResolvedValue(instructorRecord());
    mockGetOpenAI.mockResolvedValue(mockProvider as never);
    mockProvider.files.create.mockResolvedValue({ id: 'file-new' });
    mockProvider.files.retrieve.mockResolvedValue({ id: 'file-old' });
    mockProvider.files.delete.mockResolvedValue({});
    mockProvider.vectorStores.create.mockResolvedValue({ id: 'vs-new' });
    mockProvider.vectorStores.delete.mockResolvedValue({});
    mockProvider.vectorStores.fileBatches.createAndPoll.mockResolvedValue({ file_counts: { completed: 1, failed: 0 } });
    mockProvider.vectorStores.files.create.mockResolvedValue({});
    (OpenAI as unknown as jest.Mock).mockImplementation(() => mockProvider);
    mockUploadedByAssignment.mockResolvedValue([]);
    mockUploadedByResource.mockResolvedValue([]);
    mockExistsSync.mockReturnValue(true);
    (fs.createReadStream as jest.Mock).mockReturnValue({ stream: true });
    (fs.promises.writeFile as jest.Mock).mockResolvedValue(undefined);
    (fs.promises.unlink as jest.Mock).mockResolvedValue(undefined);
    (upsertAcsAssignment as jest.Mock).mockResolvedValue({ id: 'acs-1' });
    (insertUploadedFiles as jest.Mock).mockResolvedValue(undefined);
    (archiveAcsAssignment as jest.Mock).mockResolvedValue(undefined);
  });

  it('checks all local/provider material states and determines whether grading can proceed', async () => {
    mockFindResources.mockResolvedValue([
      { id: 1, file_url: '/ok.pdf', file_name: 'ok.pdf' },
      { id: 2, file_url: '/missing-openai.pdf', file_name: 'missing-openai.pdf' },
      { id: 3, file_url: '/missing-local.pdf', file_name: 'missing-local.pdf' },
      { id: 4, file_url: '/new.pdf', file_name: 'new.pdf' },
    ]);
    mockUploadedByResource.mockResolvedValue([
      { resource_id: 1, file_id: 'file-ok' },
      { resource_id: 2, file_id: 'file-stale' },
      { resource_id: 3, file_id: 'file-gone' },
    ] as never);
    mockExistsSync.mockImplementation((filePath) => !String(filePath).includes('missing-local'));
    mockProvider.files.retrieve.mockImplementation(async (id: string) => {
      if (id !== 'file-ok') throw new Error('not found');
      return { id };
    });

    const response = await checkFiles(jsonRequest('/api/assignments/check-files', { resourceIds: [1, 2, 3, 4] }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.summary).toEqual({ ok: 1, missing_openai: 1, missing_local: 1, new: 1 });
    expect(payload.data.can_proceed).toBe(true);
  });

  it('rejects empty resource selection and reports unexpected material-check errors', async () => {
    expect((await checkFiles(jsonRequest('/api/assignments/check-files', { resourceIds: [] }))).status).toBe(400);
    mockFindResources.mockRejectedValue(new Error('resource query failed'));
    const failed = await checkFiles(jsonRequest('/api/assignments/check-files', { resourceIds: [1] }));
    expect(failed.status).toBe(500);
  });

  it('returns can_proceed false when every selected material is unavailable', async () => {
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/missing.pdf', file_name: 'missing.pdf' }]);
    mockUploadedByResource.mockResolvedValue([{ resource_id: 3, file_id: 'file-gone' }] as never);
    mockExistsSync.mockReturnValue(false);
    mockProvider.files.retrieve.mockRejectedValue(new Error('not found'));

    const response = await checkFiles(jsonRequest('/api/assignments/check-files', { resourceIds: [3] }));

    await expect(response.json()).resolves.toMatchObject({ data: { can_proceed: false } });
  });

  it('validates cleanup input and the ACS assignment', async () => {
    expect((await cleanup(jsonRequest('/api/assignments/cleanup', {}))).status).toBe(400);
    mockAcs.mockResolvedValueOnce(null);
    expect((await cleanup(jsonRequest('/api/assignments/cleanup', { assignmentId: '1' }))).status).toBe(404);
  });

  it.each([
    ['a missing LMS user', null],
    ['a user with no assigned roles', { app_user_role: null }],
    ['an inactive instructor', instructorRecord('ADMIN', false)],
    ['a role without an enumeration', { app_user_role: [{ enumeration: null, is_active: true }] }],
  ])('forbids cleanup for %s', async (_label, user) => {
    mockFindUser.mockResolvedValue(user);

    const response = await cleanup(jsonRequest('/api/assignments/cleanup', { assignmentId: '1' }));

    expect(response.status).toBe(403);
  });

  it('cleans provider resources and archives the assignment', async () => {
    mockAcs.mockResolvedValue({ vector_store_id: 'vs-1' } as never);
    mockUploadedByAssignment.mockResolvedValue([{ file_id: 'file-1' }, { file_id: 'file-2' }] as never);

    const response = await cleanup(jsonRequest('/api/assignments/cleanup', { assignmentId: '1' }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      cleanupDetails: {
        vectorStore: 'success',
        files: [{ fileId: 'file-1', status: 'success' }, { fileId: 'file-2', status: 'success' }],
        assignmentStatusUpdate: 'success',
      },
    });
  });

  it('reports not-found and failed cleanup operations without losing the response', async () => {
    mockAcs.mockResolvedValue({ vector_store_id: 'vs-1' } as never);
    mockUploadedByAssignment.mockResolvedValue([{ file_id: 'file-404' }, { file_id: 'file-failed' }] as never);
    mockProvider.vectorStores.delete.mockRejectedValue({ status: 404, message: 'gone' });
    mockProvider.files.delete
      .mockRejectedValueOnce({ status: 404, message: 'gone' })
      .mockRejectedValueOnce({ status: 500, message: 'unavailable' });
    (archiveAcsAssignment as jest.Mock).mockRejectedValue(new Error('archive failed'));

    const response = await cleanup(jsonRequest('/api/assignments/cleanup', { assignmentId: '1' }));

    await expect(response.json()).resolves.toMatchObject({
      cleanupDetails: {
        vectorStore: 'not_found',
        files: [{ fileId: 'file-404', status: 'not_found' }, { fileId: 'file-failed', status: 'failed' }],
        assignmentStatusUpdate: 'failed',
      },
    });
  });

  it('handles an assignment with no uploaded file records and a non-404 vector-store failure', async () => {
    mockAcs.mockResolvedValue({ vector_store_id: 'vs-1' } as never);
    mockUploadedByAssignment.mockResolvedValue(null as never);
    mockProvider.vectorStores.delete.mockRejectedValue({ status: 500, message: 'provider unavailable' });

    const response = await cleanup(jsonRequest('/api/assignments/cleanup', { assignmentId: '1' }));

    await expect(response.json()).resolves.toMatchObject({
      cleanupDetails: { vectorStore: 'failed', files: [], assignmentStatusUpdate: 'success' },
    });
  });

  it('handles cleanup provider lookup failures as request failures', async () => {
    mockAcs.mockResolvedValue({ vector_store_id: 'vs-1' } as never);
    mockUploadedByAssignment.mockRejectedValue(new Error('lookup failed'));

    const response = await cleanup(jsonRequest('/api/assignments/cleanup', { assignmentId: '1' }));

    expect(response.status).toBe(500);
  });

  it('validates setup fields, explicit material selection, and selected LMS resources', async () => {
    expect((await createSetup(jsonRequest('/api/assignments/create', {}))).status).toBe(400);
    expect((await createSetup(jsonRequest('/api/assignments/create', { assignmentId: 1, courseId: 2, rubric: {} }))).status).toBe(422);

    mockAcs.mockResolvedValue(null);
    mockFindResources.mockResolvedValue([]);
    const noResources = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }));
    expect(noResources.status).toBe(422);
  });

  it.each([
    ['a missing LMS user', null],
    ['a user with no roles', { app_user_role: null }],
    ['an inactive teacher', instructorRecord('TEACHER', false)],
    ['a role without an enumeration', { app_user_role: [{ enumeration: null, is_active: true }] }],
  ])('forbids setup for %s', async (_label, user) => {
    mockFindUser.mockResolvedValue(user);

    const response = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }));

    expect(response.status).toBe(403);
  });

  it('rejects setup when selected files are absent or fail to upload', async () => {
    mockAcs.mockResolvedValue(null);
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/missing.pdf', file_name: 'missing.pdf', file_type: null }]);
    mockExistsSync.mockReturnValue(false);
    expect((await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }))).status).toBe(422);

    mockExistsSync.mockReturnValue(true);
    mockProvider.files.create.mockRejectedValue(new Error('upload failed'));
    expect((await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }))).status).toBe(422);
  });

  it('reuses valid provider files and completes setup without recording duplicates', async () => {
    mockAcs.mockResolvedValue(null);
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/existing.pdf', file_name: 'existing.pdf', file_type: 'pdf' }]);
    mockUploadedByResource.mockResolvedValue([{ resource_id: 3, file_id: 'file-old' }] as never);

    const response = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: { criteria: [] }, resourceIds: [3],
    }));

    expect(response.status).toBe(200);
    expect(mockProvider.files.create).not.toHaveBeenCalled();
    expect(insertUploadedFiles).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ data: { files_reused: 1, files_uploaded: 0 } });
  });

  it('reuploads stale files, replaces the vector store, and retains partial-index warnings', async () => {
    mockAcs.mockResolvedValue({ vector_store_id: 'vs-old' } as never);
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/stale.pdf', file_name: 'stale.pdf', file_type: null }]);
    mockUploadedByResource.mockResolvedValue([{ resource_id: 3, file_id: 'file-old' }] as never);
    mockProvider.files.retrieve.mockRejectedValue(new Error('gone'));
    mockProvider.vectorStores.delete.mockRejectedValueOnce(new Error('old store already gone')).mockResolvedValue({});
    mockProvider.vectorStores.fileBatches.createAndPoll.mockResolvedValue({ file_counts: { completed: 1, failed: 1 } });
    (insertUploadedFiles as jest.Mock).mockRejectedValue(new Error('recording failed'));

    const response = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: { criteria: [] }, resourceIds: [3],
    }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data.warning).toContain('1 file(s) failed');
    expect(upsertAcsAssignment).toHaveBeenCalledWith(expect.objectContaining({ rerun_grading: true }));
  });

  it('uses unknown file metadata and skips old-store deletion when a rerun has no store ID', async () => {
    mockAcs.mockResolvedValue({ vector_store_id: '' } as never);
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/README', file_name: 'README', file_type: null }]);

    const response = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }));

    expect(response.status).toBe(200);
    expect(mockProvider.vectorStores.delete).not.toHaveBeenCalled();
    expect(insertUploadedFiles).toHaveBeenCalledWith([
      expect.objectContaining({ type_file: 'unknown' }),
    ]);
  });

  it('deletes a new vector store when indexing throws or produces no usable files', async () => {
    mockAcs.mockResolvedValue(null);
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/file.pdf', file_name: 'file.pdf', file_type: 'pdf' }]);
    mockProvider.vectorStores.fileBatches.createAndPoll.mockRejectedValueOnce(new Error('index failed'));
    expect((await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }))).status).toBe(502);

    mockProvider.vectorStores.fileBatches.createAndPoll.mockResolvedValueOnce({ file_counts: { completed: 0, failed: 1 } });
    expect((await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }))).status).toBe(502);

    expect(mockProvider.vectorStores.delete).toHaveBeenCalledTimes(2);
  });

  it('rolls back the vector store when saving setup metadata fails', async () => {
    mockAcs.mockResolvedValue(null);
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/file.pdf', file_name: 'file.pdf', file_type: 'pdf' }]);
    (upsertAcsAssignment as jest.Mock).mockRejectedValue(new Error('DB unavailable'));

    const response = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }));

    expect(response.status).toBe(500);
    expect(mockProvider.vectorStores.delete).toHaveBeenCalledWith('vs-new');
  });

  it('stringifies a non-Error setup persistence failure', async () => {
    mockAcs.mockResolvedValue(null);
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/file.pdf', file_name: 'file.pdf', file_type: 'pdf' }]);
    (upsertAcsAssignment as jest.Mock).mockRejectedValue('DB unavailable');

    const response = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }));

    await expect(response.json()).resolves.toMatchObject({ details: 'DB unavailable' });
  });

  it('stringifies a null setup persistence failure', async () => {
    mockAcs.mockResolvedValue(null);
    mockFindResources.mockResolvedValue([{ id: 3, file_url: '/file.pdf', file_name: 'file.pdf', file_type: 'pdf' }]);
    (upsertAcsAssignment as jest.Mock).mockRejectedValue(null);

    const response = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }));

    await expect(response.json()).resolves.toMatchObject({ details: 'null' });
  });

  it('reports unexpected setup errors', async () => {
    mockAcs.mockRejectedValue(new Error('setup query failed'));

    const response = await createSetup(jsonRequest('/api/assignments/create', {
      assignmentId: 1, courseId: 2, rubric: {}, resourceIds: [3],
    }));

    expect(response.status).toBe(500);
  });

  it('validates uploaded grading files and their assignment setup', async () => {
    const empty = new FormData();
    const emptyRequest = new NextRequest('http://localhost/api/assignments/upload-files', { method: 'POST', body: empty });
    expect((await uploadSetupFile(emptyRequest)).status).toBe(400);

    const form = new FormData();
    form.set('file', new File(['answer'], 'answer.txt', { type: 'text/plain' }));
    form.set('assignmentId', '1');
    mockAcs.mockResolvedValue(null);
    const missingRequest = new NextRequest('http://localhost/api/assignments/upload-files', { method: 'POST', body: form });
    expect((await uploadSetupFile(missingRequest)).status).toBe(404);
  });

  it.each([
    ['a missing LMS user', null],
    ['a user with no roles', { app_user_role: null }],
    ['an inactive admin', instructorRecord('ADMIN', false)],
    ['a role without an enumeration', { app_user_role: [{ enumeration: null, is_active: true }] }],
  ])('forbids grading-file upload for %s', async (_label, user) => {
    mockFindUser.mockResolvedValue(user);
    const form = new FormData();
    form.set('file', new File(['answer'], 'answer.txt'));
    form.set('assignmentId', '1');

    const response = await uploadSetupFile(new NextRequest('http://localhost/api/assignments/upload-files', {
      method: 'POST', body: form,
    }));

    expect(response.status).toBe(403);
  });

  it('uploads a grading file, attaches it, records it, and removes the temporary file', async () => {
    const form = new FormData();
    form.set('file', new File(['answer'], 'answer.txt', { type: 'text/plain' }));
    form.set('assignmentId', '1');
    mockAcs.mockResolvedValue({ vector_store_id: 'vs-1' } as never);
    mockExistsSync.mockReturnValue(true);

    const response = await uploadSetupFile(new NextRequest('http://localhost/api/assignments/upload-files', { method: 'POST', body: form }));

    expect(response.status).toBe(200);
    expect(mockProvider.vectorStores.files.create).toHaveBeenCalledWith('vs-1', { file_id: 'file-new' });
    expect(insertUploadedFiles).toHaveBeenCalled();
    expect(fs.promises.unlink).toHaveBeenCalled();
  });

  it('still returns upload success when recording metadata fails and skips absent temp cleanup', async () => {
    const form = new FormData();
    form.set('file', new File(['answer'], 'answer.txt'));
    form.set('assignmentId', '1');
    mockAcs.mockResolvedValue({ vector_store_id: 'vs-1' } as never);
    mockExistsSync.mockReturnValue(false);
    (insertUploadedFiles as jest.Mock).mockRejectedValue(new Error('DB unavailable'));

    const response = await uploadSetupFile(new NextRequest('http://localhost/api/assignments/upload-files', { method: 'POST', body: form }));

    expect(response.status).toBe(200);
    expect(fs.promises.unlink).not.toHaveBeenCalled();
  });

  it('cleans the temp file and returns 500 when provider upload fails', async () => {
    const form = new FormData();
    form.set('file', new File(['answer'], 'answer.txt'));
    form.set('assignmentId', '1');
    mockAcs.mockResolvedValue({ vector_store_id: 'vs-1' } as never);
    mockExistsSync.mockReturnValue(true);
    mockProvider.files.create.mockRejectedValue(new Error('provider failed'));

    const response = await uploadSetupFile(new NextRequest('http://localhost/api/assignments/upload-files', { method: 'POST', body: form }));

    expect(response.status).toBe(500);
    expect(fs.promises.unlink).toHaveBeenCalled();
  });
});
