import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { GET as getLegacyResources, POST as createLegacyResource } from '@/app/api/courses/[code]/sessions/route';
import { GET as getSessionResources, POST as createSessionResource } from '@/app/api/courses/[code]/sessions/[sessionId]/resources/route';
import { GET as getResource, DELETE as deleteResource } from '@/app/api/courses/[code]/sessions/[sessionId]/resources/[resourceId]/route';
import { POST as uploadRuntimeFile } from '@/app/api/upload/route';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('fs/promises', () => ({ mkdir: jest.fn(), unlink: jest.fn(), writeFile: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    sessions: { findFirst: jest.fn() },
    resources: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
  },
}));

const mockSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockFindSession = prisma.sessions.findFirst as jest.Mock;
const mockCreateResource = prisma.resources.create as jest.Mock;
const mockDeleteResource = prisma.resources.delete as jest.Mock;
const mockFindResource = prisma.resources.findFirst as jest.Mock;
const mockFindResources = prisma.resources.findMany as jest.Mock;
const mockFindUniqueResource = prisma.resources.findUnique as jest.Mock;

const teacherSession = {
  user: { id: '2', name: 'Demo Teacher', email: 'teacher@example.test', role: 'TEACHER' },
  expires: '2099-01-01T00:00:00.000Z',
};

function request(path: string, method = 'GET', body?: unknown) {
  return new NextRequest(`http://localhost${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function resource(overrides: Record<string, unknown> = {}) {
  return {
    id: 9,
    file_name: 'map.pdf',
    file_tittle: 'Population Map',
    file_url: '/prototype-assets/map.pdf',
    file_type: 'pdf',
    file_size: 2048,
    content_type: 'application/pdf',
    version: 1,
    is_public: true,
    download_count: 0,
    app_user: { nama_lengkap: 'Demo Teacher' },
    ...overrides,
  };
}

describe('legacy course session resource route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'false';
    mockSession.mockResolvedValue(teacherSession);
  });

  it('validates the GET session query parameter', async () => {
    const missing = await getLegacyResources(request('/api/courses/GEO/sessions'), {
      params: Promise.resolve({ code: 'GEO' }),
    });
    const invalid = await getLegacyResources(request('/api/courses/GEO/sessions?sessionId=abc'), {
      params: Promise.resolve({ code: 'GEO' }),
    });

    expect(missing.status).toBe(400);
    expect(invalid.status).toBe(400);
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it('returns 404 when the requested session does not belong to the course', async () => {
    mockFindSession.mockResolvedValue(null);

    const response = await getLegacyResources(request('/api/courses/GEO/sessions?sessionId=3'), {
      params: Promise.resolve({ code: 'GEO' }),
    });

    expect(response.status).toBe(404);
    expect(mockFindResources).not.toHaveBeenCalled();
  });

  it('returns resources for a valid course session', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockFindResources.mockResolvedValue([resource()]);

    const response = await getLegacyResources(request('/api/courses/GEO/sessions?sessionId=3'), {
      params: Promise.resolve({ code: 'GEO' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: [{ id: 9, file_name: 'map.pdf', uploader: 'Demo Teacher' }],
    });
  });

  it('maps a legacy resource whose uploader relation is absent', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockFindResources.mockResolvedValue([resource({ app_user: null })]);

    const response = await getLegacyResources(request('/api/courses/GEO/sessions?sessionId=3'), {
      params: Promise.resolve({ code: 'GEO' }),
    });

    await expect(response.json()).resolves.toMatchObject({ data: [{ id: 9 }] });
  });

  it('returns 500 when fetching a session fails', async () => {
    mockFindSession.mockRejectedValue(new Error('database unavailable'));

    const response = await getLegacyResources(request('/api/courses/GEO/sessions?sessionId=3'), {
      params: Promise.resolve({ code: 'GEO' }),
    });

    expect(response.status).toBe(500);
  });

  it('validates the POST session ID and resource fields', async () => {
    const context = { params: Promise.resolve({ code: 'GEO' }) };
    expect((await createLegacyResource(request('/api/courses/GEO/sessions', 'POST', {}), context)).status).toBe(400);
    expect((await createLegacyResource(request('/api/courses/GEO/sessions', 'POST', { sessionId: 'abc' }), context)).status).toBe(400);
    expect((await createLegacyResource(request('/api/courses/GEO/sessions', 'POST', { sessionId: '3' }), context)).status).toBe(400);
  });

  it('rejects a POST session that does not belong to the course', async () => {
    mockFindSession.mockResolvedValue(null);

    const response = await createLegacyResource(request('/api/courses/GEO/sessions', 'POST', {
      sessionId: '3', file_url: '/file.pdf', file_name: 'file.pdf', file_type: 'pdf', uploader_id: 2,
    }), { params: Promise.resolve({ code: 'GEO' }) });

    expect(response.status).toBe(404);
  });

  it('creates a legacy resource and applies its default size', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockCreateResource.mockResolvedValue(resource({ file_size: 0 }));

    const response = await createLegacyResource(request('/api/courses/GEO/sessions', 'POST', {
      sessionId: '3', file_url: '/file.pdf', file_name: 'file.pdf', file_type: 'pdf', uploader_id: 2,
    }), { params: Promise.resolve({ code: 'GEO' }) });

    expect(response.status).toBe(200);
    expect(mockCreateResource).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ file_size: 0, session_id: 3 }),
    }));
  });

  it('maps a created legacy resource whose uploader relation is absent', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockCreateResource.mockResolvedValue(resource({ app_user: null }));

    const response = await createLegacyResource(request('/api/courses/GEO/sessions', 'POST', {
      sessionId: '3', file_url: '/file.pdf', file_name: 'file.pdf', file_type: 'pdf', uploader_id: 2,
    }), { params: Promise.resolve({ code: 'GEO' }) });

    await expect(response.json()).resolves.toMatchObject({ data: { id: 9 } });
  });

  it('returns 500 when legacy resource creation fails', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockCreateResource.mockRejectedValue(new Error('insert failed'));

    const response = await createLegacyResource(request('/api/courses/GEO/sessions', 'POST', {
      sessionId: '3', file_url: '/file.pdf', file_name: 'file.pdf', file_type: 'pdf', uploader_id: 2,
    }), { params: Promise.resolve({ code: 'GEO' }) });

    expect(response.status).toBe(500);
  });
});

describe('session resource collection route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'false';
    mockSession.mockResolvedValue(teacherSession);
  });

  it('returns mapped session resources and supports a missing uploader relation', async () => {
    mockFindResources.mockResolvedValue([resource(), resource({ id: 10, app_user: null })]);

    const response = await getSessionResources(request('/api/courses/GEO/sessions/3/resources'), {
      params: Promise.resolve({ code: 'GEO', sessionId: '3' }),
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.data).toHaveLength(2);
    expect(payload.data[1].uploader).toBeUndefined();
  });

  it('returns 500 for resource listing failures with Error and non-Error values', async () => {
    mockFindResources.mockRejectedValueOnce(new Error('query failed'));
    const errorResponse = await getSessionResources(request('/api/courses/GEO/sessions/3/resources'), {
      params: Promise.resolve({ code: 'GEO', sessionId: '3' }),
    });

    mockFindResources.mockRejectedValueOnce('query failed');
    const valueResponse = await getSessionResources(request('/api/courses/GEO/sessions/3/resources'), {
      params: Promise.resolve({ code: 'GEO', sessionId: '3' }),
    });

    expect(errorResponse.status).toBe(500);
    await expect(errorResponse.json()).resolves.toMatchObject({ details: 'query failed' });
    await expect(valueResponse.json()).resolves.toMatchObject({ details: 'Failed to fetch resources' });
  });

  it('validates required resource fields before querying the session', async () => {
    const response = await createSessionResource(request('/api/courses/GEO/sessions/3/resources', 'POST', {}), {
      params: Promise.resolve({ code: 'GEO', sessionId: '3' }),
    });

    expect(response.status).toBe(400);
    expect(mockFindSession).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing session', null],
    ['a session without a user', { expires: teacherSession.expires }],
    ['a user without an ID', { ...teacherSession, user: { ...teacherSession.user, id: undefined } }],
  ])('rejects resource creation for %s', async (_label, session) => {
    mockSession.mockResolvedValue(session as never);

    const response = await createSessionResource(request('/api/courses/GEO/sessions/3/resources', 'POST', {
      file_url: '/file.bin', file_name: 'file.bin', file_type: 'binary',
    }), { params: Promise.resolve({ code: 'GEO', sessionId: '3' }) });

    expect(response.status).toBe(401);
  });

  it('rejects a student before saving a resource', async () => {
    mockSession.mockResolvedValue({ ...teacherSession, user: { ...teacherSession.user, role: 'STUDENT' } });

    const response = await createSessionResource(request('/api/courses/GEO/sessions/3/resources', 'POST', {
      file_url: '/file.bin', file_name: 'file.bin', file_type: 'binary',
    }), { params: Promise.resolve({ code: 'GEO', sessionId: '3' }) });

    expect(response.status).toBe(403);
  });

  it('returns 404 when the target resource session is absent', async () => {
    mockFindSession.mockResolvedValue(null);

    const response = await createSessionResource(request('/api/courses/GEO/sessions/3/resources', 'POST', {
      file_url: '/file.bin', file_name: 'file.bin', file_type: 'binary',
    }), { params: Promise.resolve({ code: 'GEO', sessionId: '3' }) });

    expect(response.status).toBe(404);
  });

  it('creates a session resource with upload metadata defaults', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockCreateResource.mockResolvedValue(resource({ file_size: 0, content_type: 'application/octet-stream' }));

    const response = await createSessionResource(request('/api/courses/GEO/sessions/3/resources', 'POST', {
      file_url: '/file.bin', file_name: 'file.bin', file_tittle: 'Binary file', file_type: 'binary',
      title: 'Display title', description: 'Display description',
    }), { params: Promise.resolve({ code: 'GEO', sessionId: '3' }) });

    expect(response.status).toBe(200);
    expect(mockCreateResource).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ uploader_id: 2, file_size: 0, content_type: 'application/octet-stream' }),
    }));
    await expect(response.json()).resolves.toMatchObject({
      data: { title: 'Display title', description: 'Display description' },
    });
  });

  it('maps a newly created resource whose uploader relation is absent', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockCreateResource.mockResolvedValue(resource({ app_user: null }));

    const response = await createSessionResource(request('/api/courses/GEO/sessions/3/resources', 'POST', {
      file_url: '/file.bin', file_name: 'file.bin', file_type: 'binary',
    }), { params: Promise.resolve({ code: 'GEO', sessionId: '3' }) });

    await expect(response.json()).resolves.toMatchObject({ data: { id: 9 } });
  });

  it('returns a detailed 500 when session resource creation fails', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockCreateResource.mockRejectedValue(new Error('insert failed'));

    const response = await createSessionResource(request('/api/courses/GEO/sessions/3/resources', 'POST', {
      file_url: '/file.bin', file_name: 'file.bin', file_type: 'binary',
    }), { params: Promise.resolve({ code: 'GEO', sessionId: '3' }) });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ details: 'insert failed' });
  });

  it('uses the fallback detail for a non-Error resource creation failure', async () => {
    mockFindSession.mockResolvedValue({ id: 3 });
    mockCreateResource.mockRejectedValue('insert failed');

    const response = await createSessionResource(request('/api/courses/GEO/sessions/3/resources', 'POST', {
      file_url: '/file.bin', file_name: 'file.bin', file_type: 'binary',
    }), { params: Promise.resolve({ code: 'GEO', sessionId: '3' }) });

    await expect(response.json()).resolves.toMatchObject({ details: 'Failed to save resource' });
  });
});

describe('individual resource route', () => {
  const context = { params: Promise.resolve({ code: 'GEO', sessionId: '3', resourceId: '9' }) };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'false';
    mockSession.mockResolvedValue(teacherSession);
    (unlink as jest.Mock).mockResolvedValue(undefined);
    mockDeleteResource.mockResolvedValue(resource());
  });

  it('returns 404 when an individual resource does not exist', async () => {
    mockFindUniqueResource.mockResolvedValue(null);

    const response = await getResource(request('/api/courses/GEO/sessions/3/resources/9'), context);

    expect(response.status).toBe(404);
  });

  it('returns the requested resource', async () => {
    mockFindUniqueResource.mockResolvedValue(resource());

    const response = await getResource(request('/api/courses/GEO/sessions/3/resources/9'), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { id: 9, uploader: 'Demo Teacher' } });
  });

  it('maps an individual resource whose uploader relation is absent', async () => {
    mockFindUniqueResource.mockResolvedValue(resource({ app_user: null }));

    const response = await getResource(request('/api/courses/GEO/sessions/3/resources/9'), context);

    await expect(response.json()).resolves.toMatchObject({ data: { id: 9 } });
  });

  it('handles Error and non-Error resource lookup failures', async () => {
    mockFindUniqueResource.mockRejectedValueOnce(new Error('query failed'));
    const errorResponse = await getResource(request('/api/courses/GEO/sessions/3/resources/9'), context);
    mockFindUniqueResource.mockRejectedValueOnce('query failed');
    const valueResponse = await getResource(request('/api/courses/GEO/sessions/3/resources/9'), context);

    await expect(errorResponse.json()).resolves.toMatchObject({ details: 'query failed' });
    await expect(valueResponse.json()).resolves.toMatchObject({ details: 'Failed to fetch resource' });
  });

  it('returns 404 before deletion when the resource is outside the course session', async () => {
    mockFindResource.mockResolvedValue(null);

    const response = await deleteResource(request('/api/courses/GEO/sessions/3/resources/9', 'DELETE'), context);

    expect(response.status).toBe(404);
    expect(mockDeleteResource).not.toHaveBeenCalled();
  });

  it('rejects a student before deleting a resource', async () => {
    mockSession.mockResolvedValue({ ...teacherSession, user: { ...teacherSession.user, role: 'STUDENT' } });

    const response = await deleteResource(request('/api/courses/GEO/sessions/3/resources/9', 'DELETE'), context);

    expect(response.status).toBe(403);
  });

  it('deletes a database-only link without touching the filesystem', async () => {
    mockFindResource.mockResolvedValue(resource({ file_type: 'link', file_url: 'https://example.test/material' }));

    const response = await deleteResource(request('/api/courses/GEO/sessions/3/resources/9', 'DELETE'), context);

    expect(response.status).toBe(200);
    expect(mockDeleteResource).toHaveBeenCalledWith({ where: { id: 9 } });
    expect(unlink).not.toHaveBeenCalled();
  });

  it('deletes an uploaded file and tolerates a missing physical file', async () => {
    mockFindResource.mockResolvedValue(resource({ file_type: 'pdf', file_url: '/uploads/file.pdf' }));

    const success = await deleteResource(request('/api/courses/GEO/sessions/3/resources/9', 'DELETE'), context);
    expect(success.status).toBe(200);
    expect(unlink).toHaveBeenCalledTimes(1);

    jest.clearAllMocks();
    mockSession.mockResolvedValue(teacherSession);
    mockFindResource.mockResolvedValue(resource({ file_type: 'pdf', file_url: '/uploads/file.pdf' }));
    mockDeleteResource.mockResolvedValue(resource());
    (unlink as jest.Mock).mockRejectedValue(new Error('already gone'));
    const missing = await deleteResource(request('/api/courses/GEO/sessions/3/resources/9', 'DELETE'), context);
    expect(missing.status).toBe(200);
  });

  it('does not unlink non-upload resource paths', async () => {
    mockFindResource.mockResolvedValue(resource({ file_type: 'pdf', file_url: '/prototype-assets/file.pdf' }));

    expect((await deleteResource(request('/api/courses/GEO/sessions/3/resources/9', 'DELETE'), context)).status).toBe(200);
    expect(unlink).not.toHaveBeenCalled();
  });

  it('returns a detailed 500 when database deletion fails', async () => {
    mockFindResource.mockResolvedValue(resource());
    mockDeleteResource.mockRejectedValue(new Error('delete failed'));

    const response = await deleteResource(request('/api/courses/GEO/sessions/3/resources/9', 'DELETE'), context);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ details: 'delete failed' });
  });

  it('uses the fallback detail for a non-Error deletion failure', async () => {
    mockFindResource.mockResolvedValue(resource());
    mockDeleteResource.mockRejectedValue('delete failed');

    const response = await deleteResource(request('/api/courses/GEO/sessions/3/resources/9', 'DELETE'), context);

    await expect(response.json()).resolves.toMatchObject({ details: 'Failed to delete resource' });
  });
});

describe('runtime upload route outside prototype mode', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'false';
    mockSession.mockResolvedValue(teacherSession);
    (mkdir as jest.Mock).mockResolvedValue(undefined);
    (writeFile as jest.Mock).mockResolvedValue(undefined);
    jest.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
  });

  afterEach(() => jest.restoreAllMocks());

  function formRequest(file?: File, context?: string) {
    const form = new FormData();
    if (file) form.set('file', file);
    form.set('courseCode', 'GEO');
    form.set('sessionId', '3');
    if (context !== undefined) form.set('context', context);
    return new NextRequest('http://localhost/api/upload', { method: 'POST', body: form });
  }

  it('rejects requests without a file', async () => {
    const response = await uploadRuntimeFile(formRequest());

    expect(response.status).toBe(400);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('rejects files over the ten-megabyte limit', async () => {
    const largeFile = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.pdf', { type: 'application/pdf' });

    const response = await uploadRuntimeFile(formRequest(largeFile));

    expect(response.status).toBe(413);
    expect(mkdir).not.toHaveBeenCalled();
  });

  it('returns 500 if the upload directory cannot be created', async () => {
    (mkdir as jest.Mock).mockRejectedValue(new Error('read only'));

    const response = await uploadRuntimeFile(formRequest(new File(['map'], 'map.pdf')));

    expect(response.status).toBe(500);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it.each([
    ['nested context', 'materials', 'Population Map.PDF', 'application/pdf', '/materials/1700000000000_Population_Map.PDF'],
    ['session root', undefined, 'README', 'application/octet-stream', '/sessions/3/1700000000000_README'],
    ['unknown extension', undefined, 'archive.custom', 'application/octet-stream', '/sessions/3/1700000000000_archive.custom'],
  ])('writes a sanitized upload with %s', async (_label, context, name, contentType, urlSuffix) => {
    const response = await uploadRuntimeFile(formRequest(new File(['content'], name, { type: 'text/plain' }), context));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining(`1700000000000_${name.replace(/[^a-zA-Z0-9.-]/g, '_')}`), expect.any(Buffer));
    expect(payload.data.content_type).toBe(contentType);
    expect(payload.data.url).toContain(urlSuffix);
  });

  it('returns 500 when writing an uploaded file fails', async () => {
    (writeFile as jest.Mock).mockRejectedValue(new Error('write failed'));

    const response = await uploadRuntimeFile(formRequest(new File(['map'], 'map.pdf')));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ details: 'write failed' });
  });

  it('uses the fallback detail for a non-Error form-data failure', async () => {
    const failingRequest = {
      formData: jest.fn().mockRejectedValue('form data failed'),
    } as unknown as NextRequest;

    const response = await uploadRuntimeFile(failingRequest);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ details: 'Unknown error' });
  });
});
