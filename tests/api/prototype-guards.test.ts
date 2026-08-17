import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { getToken } from 'next-auth/jwt';
import { OpenAI } from 'openai';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { requireAdmin } from '@/lib/auth/require-admin';
import { getOpenAI } from '@/lib/openai';
import { gradeStudentAnswer } from '@/lib/grading-service';
import { initDetection, processDetection } from '@/lib/plagiarism/detection';
import { prisma } from '@/lib/prisma';
import {
  archiveAcsAssignment,
  getAcsAssignmentByAssignmentId,
  getUploadedFilesByAssignmentId,
  getUploadedFilesByResourceIds,
  insertUploadedFiles,
  upsertAcsAssignment,
} from '@/lib/db2/acs-repo';
import { deleteCredential, getCredential, upsertCredential } from '@/lib/db2/admin-repo';
import { proxy } from '@/proxy';
import { POST as runAll } from '@/app/api/ai-grading/run-all/route';
import { POST as runSingle } from '@/app/api/ai-grading/run-single/route';
import { POST as detectPlagiarism } from '@/app/api/plagiarism/detect/route';
import { POST as createGradingSetup } from '@/app/api/assignments/create/route';
import { POST as checkGradingFiles } from '@/app/api/assignments/check-files/route';
import { POST as uploadGradingFile } from '@/app/api/assignments/upload-files/route';
import { POST as cleanupGradingFiles } from '@/app/api/assignments/cleanup/route';
import {
  DELETE as deleteProviderCredential,
  GET as readProviderCredential,
  PUT as saveProviderCredential,
} from '@/app/api/admin/credentials/route';
import { POST as uploadRuntimeFile } from '@/app/api/upload/route';
import { POST as createCourseResource } from '@/app/api/courses/[code]/sessions/[sessionId]/resources/route';
import { DELETE as deleteCourseResource } from '@/app/api/courses/[code]/sessions/[sessionId]/resources/[resourceId]/route';
import { POST as createLegacyCourseResource } from '@/app/api/courses/[code]/sessions/route';
import {
  isPrototypeMode,
  prototypeExternalProcessingResponse,
} from '@/lib/prototype-mode';

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('next-auth/jwt', () => ({
  getToken: jest.fn(),
}));

jest.mock('openai', () => ({
  OpenAI: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  mkdir: jest.fn(),
  unlink: jest.fn(),
  writeFile: jest.fn(),
}));

jest.mock('@/lib/auth/require-admin', () => ({
  requireAdmin: jest.fn(),
}));

jest.mock('@/lib/openai', () => ({
  getOpenAI: jest.fn(),
  resetOpenAICache: jest.fn(),
}));

jest.mock('@/lib/grading-service', () => ({
  gradeStudentAnswer: jest.fn(),
}));

jest.mock('@/lib/plagiarism/detection', () => ({
  initDetection: jest.fn(),
  processDetection: jest.fn(),
}));

jest.mock('@/lib/feature-access', () => ({
  canUseFeature: jest.fn(),
}));

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

jest.mock('@/lib/crypto', () => ({
  encryptSecret: jest.fn(),
  maskSecret: jest.fn(),
}));

jest.mock('@/lib/audit', () => ({
  logAudit: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    app_user: { findUnique: jest.fn() },
    assignments: { findUnique: jest.fn() },
    assignment_submissions: { findMany: jest.fn() },
    resources: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    sessions: { findFirst: jest.fn() },
  },
}));

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockGetToken = getToken as jest.MockedFunction<typeof getToken>;
const mockRequireAdmin = requireAdmin as jest.MockedFunction<typeof requireAdmin>;
const mockFindUser = prisma.app_user.findUnique as jest.Mock;

const disabledPayload = {
  success: false,
  code: 'PROTOTYPE_EXTERNAL_PROCESSING_DISABLED',
  error: 'External processing is disabled in this prototype',
};

function teacherSession() {
  return {
    user: {
      id: '2',
      name: 'Demo Teacher',
      email: 'teacher@example.test',
      role: 'TEACHER',
    },
    expires: '2099-01-01T00:00:00.000Z',
  };
}

function jsonRequest(path: string, method = 'POST') {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'DELETE' ? undefined : JSON.stringify({}),
  });
}

async function expectPrototypeDisabled(response: Response) {
  expect(response.status).toBe(503);
  await expect(response.json()).resolves.toEqual(disabledPayload);
}

describe('prototype external-processing guards', () => {
  const originalPrototypeMode = process.env.PROTOTYPE_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'true';
    mockGetServerSession.mockResolvedValue(teacherSession());
    mockFindUser.mockResolvedValue({
      app_user_role: [{ is_active: true, enumeration: { name: 'TEACHER' } }],
    });
    mockRequireAdmin.mockResolvedValue({
      ok: true,
      user: { id: '1', name: 'Demo Admin' },
    } as never);
  });

  afterAll(() => {
    if (originalPrototypeMode === undefined) {
      delete process.env.PROTOTYPE_MODE;
    } else {
      process.env.PROTOTYPE_MODE = originalPrototypeMode;
    }
  });

  it('leaves normal mode enabled when the server flag is not true', () => {
    process.env.PROTOTYPE_MODE = 'false';

    expect(isPrototypeMode()).toBe(false);
    expect(prototypeExternalProcessingResponse()).toBeNull();
  });

  it.each([
    ['mass grading', () => runAll(jsonRequest('/api/ai-grading/run-all'))],
    ['single-answer grading', () => runSingle(jsonRequest('/api/ai-grading/run-single'))],
    ['plagiarism detection', () => detectPlagiarism(jsonRequest('/api/plagiarism/detect'))],
    ['grading material setup', () => createGradingSetup(jsonRequest('/api/assignments/create'))],
    ['grading material check', () => checkGradingFiles(jsonRequest('/api/assignments/check-files'))],
    ['grading material upload', () => uploadGradingFile(jsonRequest('/api/assignments/upload-files'))],
    ['grading material cleanup', () => cleanupGradingFiles(jsonRequest('/api/assignments/cleanup'))],
    ['provider credential save', () => saveProviderCredential(jsonRequest('/api/admin/credentials', 'PUT'))],
    ['provider credential delete', () => deleteProviderCredential()],
  ])('blocks %s after authentication', async (_name, callRoute) => {
    await expectPrototypeDisabled(await callRoute());

    expect(OpenAI).not.toHaveBeenCalled();
    expect(getOpenAI).not.toHaveBeenCalled();
    expect(gradeStudentAnswer).not.toHaveBeenCalled();
    expect(initDetection).not.toHaveBeenCalled();
    expect(processDetection).not.toHaveBeenCalled();
    expect(getAcsAssignmentByAssignmentId).not.toHaveBeenCalled();
    expect(getUploadedFilesByAssignmentId).not.toHaveBeenCalled();
    expect(getUploadedFilesByResourceIds).not.toHaveBeenCalled();
    expect(insertUploadedFiles).not.toHaveBeenCalled();
    expect(upsertAcsAssignment).not.toHaveBeenCalled();
    expect(archiveAcsAssignment).not.toHaveBeenCalled();
    expect(upsertCredential).not.toHaveBeenCalled();
    expect(deleteCredential).not.toHaveBeenCalled();
  });

  it('still returns unauthorized before the prototype guard', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await runSingle(jsonRequest('/api/ai-grading/run-single'));

    expect(response.status).toBe(401);
    expect(getOpenAI).not.toHaveBeenCalled();
    expect(gradeStudentAnswer).not.toHaveBeenCalled();
  });

  it.each([
    ['mass grading', () => runAll(jsonRequest('/api/ai-grading/run-all'))],
    ['single grading', () => runSingle(jsonRequest('/api/ai-grading/run-single'))],
    ['plagiarism detection', () => detectPlagiarism(jsonRequest('/api/plagiarism/detect'))],
    ['grading setup', () => createGradingSetup(jsonRequest('/api/assignments/create'))],
    ['grading file check', () => checkGradingFiles(jsonRequest('/api/assignments/check-files'))],
    ['grading file upload', () => uploadGradingFile(jsonRequest('/api/assignments/upload-files'))],
    ['grading cleanup', () => cleanupGradingFiles(jsonRequest('/api/assignments/cleanup'))],
  ])('returns 401 before the prototype guard for unauthenticated %s', async (_name, callRoute) => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await callRoute();

    expect(response.status).toBe(401);
    expect(getOpenAI).not.toHaveBeenCalled();
    expect(OpenAI).not.toHaveBeenCalled();
  });

  it.each([
    ['mass grading', () => runAll(jsonRequest('/api/ai-grading/run-all'))],
    ['single grading', () => runSingle(jsonRequest('/api/ai-grading/run-single'))],
    ['plagiarism detection', () => detectPlagiarism(jsonRequest('/api/plagiarism/detect'))],
    ['grading setup', () => createGradingSetup(jsonRequest('/api/assignments/create'))],
    ['grading file check', () => checkGradingFiles(jsonRequest('/api/assignments/check-files'))],
    ['grading file upload', () => uploadGradingFile(jsonRequest('/api/assignments/upload-files'))],
    ['grading cleanup', () => cleanupGradingFiles(jsonRequest('/api/assignments/cleanup'))],
  ])('returns 403 before the prototype guard for forbidden %s', async (_name, callRoute) => {
    mockGetServerSession.mockResolvedValue({
      ...teacherSession(),
      user: { ...teacherSession().user, role: 'STUDENT' },
    });
    mockFindUser.mockResolvedValue({
      app_user_role: [{ is_active: true, enumeration: { name: 'STUDENT' } }],
    });

    const response = await callRoute();

    expect(response.status).toBe(403);
    expect(getOpenAI).not.toHaveBeenCalled();
    expect(OpenAI).not.toHaveBeenCalled();
  });

  it.each([
    ['save', () => saveProviderCredential(jsonRequest('/api/admin/credentials', 'PUT'))],
    ['delete', () => deleteProviderCredential()],
  ])('returns the admin 401 before the credential %s guard', async (_name, callRoute) => {
    mockRequireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ success: false, error: 'Unauthorized' }, { status: 401 }),
    } as never);

    const response = await callRoute();

    expect(response.status).toBe(401);
    expect(upsertCredential).not.toHaveBeenCalled();
    expect(deleteCredential).not.toHaveBeenCalled();
  });

  it.each([
    ['save', () => saveProviderCredential(jsonRequest('/api/admin/credentials', 'PUT'))],
    ['delete', () => deleteProviderCredential()],
  ])('returns the admin 403 before the credential %s guard', async (_name, callRoute) => {
    mockRequireAdmin.mockResolvedValue({
      ok: false,
      response: Response.json({ success: false, error: 'Forbidden' }, { status: 403 }),
    } as never);

    const response = await callRoute();

    expect(response.status).toBe(403);
    expect(upsertCredential).not.toHaveBeenCalled();
    expect(deleteCredential).not.toHaveBeenCalled();
  });

  it('does not inspect a stored or environment provider key in prototype mode', async () => {
    const response = await readProviderCredential();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: {
        provider: 'openai',
        configured: false,
        source: 'none',
        key_hint: null,
        updated_by: null,
        updated_at: null,
      },
    });
    expect(getCredential).not.toHaveBeenCalled();
  });

  it('authenticates before blocking a direct runtime upload', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await uploadRuntimeFile(jsonRequest('/api/upload'));

    expect(response.status).toBe(401);
    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('blocks a direct runtime upload before parsing or writing the file', async () => {
    await expectPrototypeDisabled(await uploadRuntimeFile(jsonRequest('/api/upload')));

    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('blocks direct resource creation before database mutation', async () => {
    const response = await createCourseResource(
      jsonRequest('/api/courses/GEO/sessions/1/resources'),
      { params: Promise.resolve({ code: 'GEO', sessionId: '1' }) }
    );

    await expectPrototypeDisabled(response);
    expect(prisma.sessions.findFirst).not.toHaveBeenCalled();
    expect(prisma.resources.create).not.toHaveBeenCalled();
  });

  it('blocks the legacy resource creation route before params, body, or database mutation', async () => {
    const response = await createLegacyCourseResource(
      jsonRequest('/api/courses/GEO/sessions'),
      { params: Promise.resolve({ code: 'GEO' }) }
    );

    await expectPrototypeDisabled(response);
    expect(prisma.sessions.findFirst).not.toHaveBeenCalled();
    expect(prisma.resources.create).not.toHaveBeenCalled();
  });

  it('authenticates before the legacy resource creation guard', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await createLegacyCourseResource(
      jsonRequest('/api/courses/GEO/sessions'),
      { params: Promise.resolve({ code: 'GEO' }) }
    );

    expect(response.status).toBe(401);
    expect(prisma.resources.create).not.toHaveBeenCalled();
  });

  it('checks instructor role before the legacy resource creation guard', async () => {
    mockGetServerSession.mockResolvedValue({
      ...teacherSession(),
      user: { ...teacherSession().user, role: 'STUDENT' },
    });

    const response = await createLegacyCourseResource(
      jsonRequest('/api/courses/GEO/sessions'),
      { params: Promise.resolve({ code: 'GEO' }) }
    );

    expect(response.status).toBe(403);
    expect(prisma.resources.create).not.toHaveBeenCalled();
  });

  it('checks the instructor role before the resource creation guard', async () => {
    mockGetServerSession.mockResolvedValue({ ...teacherSession(), user: { ...teacherSession().user, role: 'STUDENT' } });

    const response = await createCourseResource(
      jsonRequest('/api/courses/GEO/sessions/1/resources'),
      { params: Promise.resolve({ code: 'GEO', sessionId: '1' }) }
    );

    expect(response.status).toBe(403);
    expect(prisma.sessions.findFirst).not.toHaveBeenCalled();
    expect(prisma.resources.create).not.toHaveBeenCalled();
  });

  it('blocks direct resource deletion before database or filesystem mutation', async () => {
    const response = await deleteCourseResource(
      jsonRequest('/api/courses/GEO/sessions/1/resources/2', 'DELETE'),
      { params: Promise.resolve({ code: 'GEO', sessionId: '1', resourceId: '2' }) }
    );

    await expectPrototypeDisabled(response);
    expect(prisma.resources.findFirst).not.toHaveBeenCalled();
    expect(prisma.resources.delete).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it('authenticates before the direct resource deletion guard', async () => {
    mockGetServerSession.mockResolvedValue(null);

    const response = await deleteCourseResource(
      jsonRequest('/api/courses/GEO/sessions/1/resources/2', 'DELETE'),
      { params: Promise.resolve({ code: 'GEO', sessionId: '1', resourceId: '2' }) }
    );

    expect(response.status).toBe(401);
    expect(prisma.resources.findFirst).not.toHaveBeenCalled();
    expect(prisma.resources.delete).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });
});

describe('cron middleware exemption', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetToken.mockResolvedValue(null);
  });

  it('exempts exactly /api/cron/reset without reading a login token', async () => {
    const response = await proxy(new NextRequest('http://localhost/api/cron/reset'));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it('does not exempt a nested path that merely starts with the cron path', async () => {
    const response = await proxy(new NextRequest('http://localhost/api/cron/reset/extra'));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });

  it.each([
    '/_next/static/chunks/app.js',
    '/favicon.ico',
    '/images/logo.png',
    '/icons/menu.svg',
    '/prototype-assets/material-contoh.txt',
    '/st_louis-2.png',
  ])('allows the known public static asset %s without reading a login token', async pathname => {
    const response = await proxy(new NextRequest(`http://localhost${pathname}`));

    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(mockGetToken).not.toHaveBeenCalled();
  });

  it.each([
    '/private-report.pdf',
    '/api/files/submission.pdf',
    '/images-private/logo.png',
    '/prototype-assets-private/material.txt',
  ])('does not bypass authentication merely because %s looks like an asset', async pathname => {
    const response = await proxy(new NextRequest(`http://localhost${pathname}`));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });

  it.each(['/login-private', '/authorization'])
  ('does not treat the prefix-confusable route %s as public', async pathname => {
    const response = await proxy(new NextRequest(`http://localhost${pathname}`));

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/login');
    expect(mockGetToken).toHaveBeenCalledTimes(1);
  });
});
