import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/prisma';
import {
  getGradingResultsByJobAndStudent,
  getLatestCompletedJobByAssignment,
} from '@/lib/db2/acs-repo';
import { getComparisonsBySubmissionIds } from '@/lib/db2/pds-repo';
import { queryLMS } from '@/lib/lms-db';
import { GET as getGradingResults } from '@/app/api/ai-grading/results/[assignmentId]/route';
import { GET as getForumPosts, POST as createForumPost } from '@/app/api/courses/[code]/forums/[forumId]/posts/route';
import { GET as getMaterials, POST as createMaterial } from '@/app/api/courses/[code]/sessions/[sessionId]/materials/route';
import { PUT as updateMaterial, DELETE as deleteMaterial } from '@/app/api/courses/[code]/sessions/[sessionId]/materials/[id]/route';
import { PATCH as reorderMaterial } from '@/app/api/courses/[code]/sessions/[sessionId]/materials/[id]/reorder/route';
import { GET as getPlagiarismResults } from '@/app/api/plagiarism/results/[assignmentId]/route';

jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/db2/acs-repo', () => ({
  getGradingResultsByJobAndStudent: jest.fn(),
  getLatestCompletedJobByAssignment: jest.fn(),
}));
jest.mock('@/lib/db2/pds-repo', () => ({ getComparisonsBySubmissionIds: jest.fn() }));
jest.mock('@/lib/lms-db', () => ({ queryLMS: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: jest.fn(),
    $transaction: jest.fn(),
    forums: { findUnique: jest.fn() },
    forum_attachments: { create: jest.fn() },
    forum_posts: { count: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    materials: {
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    sessions: { findFirst: jest.fn() },
  },
}));

const mockSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockLatestJob = getLatestCompletedJobByAssignment as jest.Mock;
const mockGradingResults = getGradingResultsByJobAndStudent as jest.Mock;
const mockQueryLMS = queryLMS as jest.Mock;
const mockComparisons = getComparisonsBySubmissionIds as jest.Mock;
const mockFindForum = prisma.forums.findUnique as jest.Mock;
const mockFindPosts = prisma.forum_posts.findMany as jest.Mock;
const mockCountPosts = prisma.forum_posts.count as jest.Mock;
const mockCreatePost = prisma.forum_posts.create as jest.Mock;
const mockCreateAttachment = prisma.forum_attachments.create as jest.Mock;
const mockFindSession = prisma.sessions.findFirst as jest.Mock;
const mockFindMaterials = prisma.materials.findMany as jest.Mock;
const mockFindMaterial = prisma.materials.findFirst as jest.Mock;
const mockCreateMaterial = prisma.materials.create as jest.Mock;
const mockUpdateMaterial = prisma.materials.update as jest.Mock;
const mockDeleteMaterial = prisma.materials.delete as jest.Mock;
const mockExecuteRaw = prisma.$executeRaw as jest.Mock;
const mockTransaction = prisma.$transaction as jest.Mock;

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

const materialCollectionContext = {
  params: Promise.resolve({ code: 'GEO', sessionId: '3' }),
};
const materialItemContext = {
  params: Promise.resolve({ code: 'GEO', sessionId: '3', id: '9' }),
};

describe('prepared grading results route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue(teacherSession);
  });

  it('requires an authenticated user', async () => {
    mockSession.mockResolvedValue(null);

    const response = await getGradingResults(
      request('/api/ai-grading/results/6?studentId=21'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    expect(response.status).toBe(401);
  });

  it('validates the assignment path and student query parameter', async () => {
    const missingAssignment = await getGradingResults(
      request('/api/ai-grading/results/empty?studentId=21'),
      { params: Promise.resolve({ assignmentId: '' }) }
    );
    const missingStudent = await getGradingResults(
      request('/api/ai-grading/results/6'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    expect(missingAssignment.status).toBe(400);
    expect(missingStudent.status).toBe(400);
    expect(mockLatestJob).not.toHaveBeenCalled();
  });

  it('returns an empty result when no completed job exists', async () => {
    mockLatestJob.mockResolvedValue(null);

    const response = await getGradingResults(
      request('/api/ai-grading/results/6?studentId=21'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    await expect(response.json()).resolves.toEqual({ success: true, data: { job: null, results: [] } });
    expect(mockGradingResults).not.toHaveBeenCalled();
  });

  it('returns results for the latest completed job', async () => {
    mockLatestJob.mockResolvedValue({ id: 'job-1', assignment_id: '6', completed_at: '2026-08-15T00:00:00Z' });
    mockGradingResults.mockResolvedValue([{ score: 92 }]);

    const response = await getGradingResults(
      request('/api/ai-grading/results/6?studentId=21'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    expect(response.status).toBe(200);
    expect(mockGradingResults).toHaveBeenCalledWith('job-1', '21');
    await expect(response.json()).resolves.toMatchObject({ data: { job: { id: 'job-1' }, results: [{ score: 92 }] } });
  });
});

describe('forum post collection route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue(teacherSession);
    mockFindForum.mockResolvedValue({ id: 7, title: 'Synthetic Forum' });
    mockFindPosts.mockResolvedValue([]);
    mockCountPosts.mockResolvedValue(0);
    mockCreatePost.mockResolvedValue({
      id: 8,
      title: 'Discussion',
      content: 'Synthetic discussion',
      content_type: 'plaintext',
      created_at: '2026-08-15T00:00:00Z',
      updated_at: '2026-08-15T00:00:00Z',
      app_user: { id: 2, nama_lengkap: 'Demo Teacher', profile_picture_url: null },
      forum_attachments: [],
    });
    mockCreateAttachment.mockImplementation(async ({ data }) => ({ id: data.file_name, ...data }));
  });

  it('validates numeric forum identifiers for reading and creation', async () => {
    const context = { params: Promise.resolve({ code: 'GEO', forumId: 'invalid' }) };

    const readResponse = await getForumPosts(request('/api/courses/GEO/forums/invalid/posts'), context);
    const createResponse = await createForumPost(
      request('/api/courses/GEO/forums/invalid/posts', 'POST', { title: 'Title', content: 'Content' }),
      context
    );

    expect(readResponse.status).toBe(400);
    expect(createResponse.status).toBe(400);
  });

  it('returns 404 when a forum is missing for reading and creation', async () => {
    mockFindForum.mockResolvedValue(null);
    const context = { params: Promise.resolve({ code: 'GEO', forumId: '7' }) };

    const readResponse = await getForumPosts(request('/api/courses/GEO/forums/7/posts'), context);
    const createResponse = await createForumPost(
      request('/api/courses/GEO/forums/7/posts', 'POST', { title: 'Title', content: 'Content' }),
      context
    );

    expect(readResponse.status).toBe(404);
    expect(createResponse.status).toBe(404);
  });

  it('uses default pagination and maps authors, replies, and attachments', async () => {
    mockFindPosts.mockResolvedValue([
      {
        id: 1,
        title: 'First post',
        content: 'Content',
        content_type: 'plaintext',
        created_at: '2026-08-15T00:00:00Z',
        updated_at: '2026-08-15T00:00:00Z',
        app_user: { id: 2, nama_lengkap: 'Demo Teacher', profile_picture_url: null },
        forum_replies: [{ id: 1 }],
        forum_attachments: [{ id: 3, file_name: 'map.pdf', file_url: '/map.pdf', file_size: 20 }],
      },
      {
        id: 2,
        title: 'Deleted author',
        content: 'Content',
        content_type: 'plaintext',
        created_at: '2026-08-15T00:00:00Z',
        updated_at: '2026-08-15T00:00:00Z',
        app_user: null,
        forum_replies: [],
        forum_attachments: [],
      },
    ]);
    mockCountPosts.mockResolvedValue(25);

    const response = await getForumPosts(
      request('/api/courses/GEO/forums/7/posts'),
      { params: Promise.resolve({ code: 'GEO', forumId: '7' }) }
    );
    const payload = await response.json();

    expect(payload.data.pagination).toEqual({ total: 25, limit: 20, offset: 0, hasMore: true });
    expect(payload.data.posts[0]).toMatchObject({ reply_count: 1, attachments: [{ file_name: 'map.pdf' }] });
    expect(payload.data.posts[1].author).toEqual({});
  });

  it('honors explicit pagination and reports the final page', async () => {
    mockCountPosts.mockResolvedValue(15);

    const response = await getForumPosts(
      request('/api/courses/GEO/forums/7/posts?limit=10&offset=10'),
      { params: Promise.resolve({ code: 'GEO', forumId: '7' }) }
    );

    await expect(response.json()).resolves.toMatchObject({
      data: { pagination: { total: 15, limit: 10, offset: 10, hasMore: false } },
    });
  });

  it('returns 500 when forum reading fails', async () => {
    mockFindForum.mockRejectedValue(new Error('database unavailable'));

    const response = await getForumPosts(
      request('/api/courses/GEO/forums/7/posts'),
      { params: Promise.resolve({ code: 'GEO', forumId: '7' }) }
    );

    expect(response.status).toBe(500);
  });

  it('requires authentication before creating a post', async () => {
    mockSession.mockResolvedValue(null);

    const response = await createForumPost(
      request('/api/courses/GEO/forums/7/posts', 'POST', { title: 'Title', content: 'Content' }),
      { params: Promise.resolve({ code: 'GEO', forumId: '7' }) }
    );

    expect(response.status).toBe(401);
  });

  it.each([
    ['title', { content: 'Content' }],
    ['content', { title: 'Title' }],
  ])('requires post %s', async (_field, body) => {
    const response = await createForumPost(
      request('/api/courses/GEO/forums/7/posts', 'POST', body),
      { params: Promise.resolve({ code: 'GEO', forumId: '7' }) }
    );

    expect(response.status).toBe(400);
  });

  it.each([
    ['missing attachments', undefined],
    ['non-array attachments', 'not-an-array'],
    ['empty attachments', []],
  ])('creates a plaintext post with %s', async (_label, attachments) => {
    const response = await createForumPost(
      request('/api/courses/GEO/forums/7/posts', 'POST', {
        title: 'Title', content: 'Content', ...(attachments === undefined ? {} : { attachments }),
      }),
      { params: Promise.resolve({ code: 'GEO', forumId: '7' }) }
    );

    expect(response.status).toBe(200);
    expect(mockCreatePost).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ content_type: 'plaintext' }),
    }));
    expect(mockCreateAttachment).not.toHaveBeenCalled();
  });

  it('creates explicit rich-text posts, persists attachments, and maps a missing author', async () => {
    mockCreatePost.mockResolvedValue({
      id: 8,
      title: 'Discussion',
      content: '<p>Content</p>',
      content_type: 'html',
      created_at: '2026-08-15T00:00:00Z',
      updated_at: '2026-08-15T00:00:00Z',
      app_user: null,
      forum_attachments: [],
    });

    const response = await createForumPost(
      request('/api/courses/GEO/forums/7/posts', 'POST', {
        title: 'Title',
        content: '<p>Content</p>',
        content_type: 'html',
        attachments: [{ file_name: 'map.pdf', file_url: '/map.pdf', file_size: 20 }],
      }),
      { params: Promise.resolve({ code: 'GEO', forumId: '7' }) }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mockCreateAttachment).toHaveBeenCalledTimes(1);
    expect(payload.data.post.author).toEqual({});
    expect(payload.data.post.attachments).toEqual([expect.objectContaining({ file_name: 'map.pdf' })]);
  });

  it('returns 500 when forum post creation fails', async () => {
    mockCreatePost.mockRejectedValue(new Error('insert failed'));

    const response = await createForumPost(
      request('/api/courses/GEO/forums/7/posts', 'POST', { title: 'Title', content: 'Content' }),
      { params: Promise.resolve({ code: 'GEO', forumId: '7' }) }
    );

    expect(response.status).toBe(500);
  });
});

describe('material collection and item routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindSession.mockResolvedValue({ id: 3 });
    mockFindMaterials.mockResolvedValue([{ id: 9, title: 'Map', material_order: 1 }]);
    mockFindMaterial.mockResolvedValue({ id: 9, title: 'Map', content: 'Content', material_order: 1 });
    mockCreateMaterial.mockResolvedValue({ id: 9, title: 'Map', content: null, material_order: 1 });
    mockUpdateMaterial.mockResolvedValue({ id: 9, title: 'Map', content: null, material_order: 1 });
    mockDeleteMaterial.mockResolvedValue({ id: 9 });
    mockExecuteRaw.mockResolvedValue(1);
  });

  it('returns 404 when reading or creating in a missing session', async () => {
    mockFindSession.mockResolvedValue(null);

    const readResponse = await getMaterials(request('/api/courses/GEO/sessions/3/materials'), materialCollectionContext);
    const createResponse = await createMaterial(
      request('/api/courses/GEO/sessions/3/materials', 'POST', { title: 'Map' }),
      materialCollectionContext
    );

    expect(readResponse.status).toBe(404);
    expect(createResponse.status).toBe(404);
  });

  it('returns materials ordered by their stored position', async () => {
    const response = await getMaterials(request('/api/courses/GEO/sessions/3/materials'), materialCollectionContext);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true, data: [{ id: 9, title: 'Map', material_order: 1 }] });
  });

  it('returns 500 when material reading fails', async () => {
    mockFindSession.mockRejectedValue(new Error('query failed'));

    const response = await getMaterials(request('/api/courses/GEO/sessions/3/materials'), materialCollectionContext);

    expect(response.status).toBe(500);
  });

  it.each([
    ['missing', {}],
    ['blank', { title: '   ' }],
  ])('rejects a %s material title', async (_label, body) => {
    const response = await createMaterial(
      request('/api/courses/GEO/sessions/3/materials', 'POST', body),
      materialCollectionContext
    );

    expect(response.status).toBe(400);
  });

  it('creates the first material with nullable content', async () => {
    mockFindMaterial.mockResolvedValue(null);

    const response = await createMaterial(
      request('/api/courses/GEO/sessions/3/materials', 'POST', { title: '  Map  ' }),
      materialCollectionContext
    );

    expect(response.status).toBe(200);
    expect(mockCreateMaterial).toHaveBeenCalledWith({
      data: { session_id: 3, title: 'Map', content: null, material_order: 1 },
    });
  });

  it.each([
    ['trimmed content', '  Synthetic content  ', 'Synthetic content'],
    ['blank content', '   ', null],
  ])('creates the next material with %s', async (_label, content, expectedContent) => {
    mockFindMaterial.mockResolvedValue({ id: 8, material_order: 4 });

    const response = await createMaterial(
      request('/api/courses/GEO/sessions/3/materials', 'POST', { title: 'Map', content }),
      materialCollectionContext
    );

    expect(response.status).toBe(200);
    expect(mockCreateMaterial).toHaveBeenCalledWith({
      data: { session_id: 3, title: 'Map', content: expectedContent, material_order: 5 },
    });
  });

  it('returns 500 when material creation fails', async () => {
    mockFindMaterial.mockRejectedValue(new Error('query failed'));

    const response = await createMaterial(
      request('/api/courses/GEO/sessions/3/materials', 'POST', { title: 'Map' }),
      materialCollectionContext
    );

    expect(response.status).toBe(500);
  });

  it.each([
    ['missing', {}],
    ['blank', { title: '   ' }],
  ])('rejects a %s updated material title', async (_label, body) => {
    const response = await updateMaterial(
      request('/api/courses/GEO/sessions/3/materials/9', 'PUT', body),
      materialItemContext
    );

    expect(response.status).toBe(400);
  });

  it('returns 404 when updating or deleting a missing material', async () => {
    mockFindMaterial.mockResolvedValue(null);

    const updateResponse = await updateMaterial(
      request('/api/courses/GEO/sessions/3/materials/9', 'PUT', { title: 'Map' }),
      materialItemContext
    );
    const deleteResponse = await deleteMaterial(
      request('/api/courses/GEO/sessions/3/materials/9', 'DELETE'),
      materialItemContext
    );

    expect(updateResponse.status).toBe(404);
    expect(deleteResponse.status).toBe(404);
  });

  it.each([
    ['missing content', undefined, null],
    ['blank content', '   ', null],
    ['trimmed content', '  Updated  ', 'Updated'],
  ])('updates a material with %s', async (_label, content, expectedContent) => {
    const response = await updateMaterial(
      request('/api/courses/GEO/sessions/3/materials/9', 'PUT', {
        title: '  Updated Map  ', ...(content === undefined ? {} : { content }),
      }),
      materialItemContext
    );

    expect(response.status).toBe(200);
    expect(mockUpdateMaterial).toHaveBeenCalledWith({
      where: { id: 9 }, data: { title: 'Updated Map', content: expectedContent },
    });
  });

  it('returns 500 when material updating fails', async () => {
    mockUpdateMaterial.mockRejectedValue(new Error('update failed'));

    const response = await updateMaterial(
      request('/api/courses/GEO/sessions/3/materials/9', 'PUT', { title: 'Map' }),
      materialItemContext
    );

    expect(response.status).toBe(500);
  });

  it('deletes a material and closes its ordering gap', async () => {
    const response = await deleteMaterial(
      request('/api/courses/GEO/sessions/3/materials/9', 'DELETE'),
      materialItemContext
    );

    expect(response.status).toBe(200);
    expect(mockDeleteMaterial).toHaveBeenCalledWith({ where: { id: 9 } });
    expect(mockExecuteRaw).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when material deletion fails', async () => {
    mockDeleteMaterial.mockRejectedValue(new Error('delete failed'));

    const response = await deleteMaterial(
      request('/api/courses/GEO/sessions/3/materials/9', 'DELETE'),
      materialItemContext
    );

    expect(response.status).toBe(500);
  });
});

describe('material reordering route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindMaterial.mockResolvedValue({ id: 9, material_order: 2 });
    mockUpdateMaterial.mockImplementation(({ data }) => Promise.resolve({ id: 9, ...data }));
    mockTransaction.mockResolvedValue([]);
  });

  it.each([
    ['missing direction', {}],
    ['unknown direction', { direction: 'sideways' }],
  ])('rejects %s', async (_label, body) => {
    const response = await reorderMaterial(
      request('/api/courses/GEO/sessions/3/materials/9/reorder', 'PATCH', body),
      materialItemContext
    );

    expect(response.status).toBe(400);
  });

  it('returns 404 when the current material is missing', async () => {
    mockFindMaterial.mockResolvedValue(null);

    const response = await reorderMaterial(
      request('/api/courses/GEO/sessions/3/materials/9/reorder', 'PATCH', { direction: 'up' }),
      materialItemContext
    );

    expect(response.status).toBe(404);
  });

  it('rejects moving the first material farther up', async () => {
    mockFindMaterial.mockResolvedValue({ id: 9, material_order: 1 });

    const response = await reorderMaterial(
      request('/api/courses/GEO/sessions/3/materials/9/reorder', 'PATCH', { direction: 'up' }),
      materialItemContext
    );

    expect(response.status).toBe(400);
  });

  it('rejects moving down when no maximum order exists', async () => {
    mockFindMaterial
      .mockResolvedValueOnce({ id: 9, material_order: 2 })
      .mockResolvedValueOnce(null);

    const response = await reorderMaterial(
      request('/api/courses/GEO/sessions/3/materials/9/reorder', 'PATCH', { direction: 'down' }),
      materialItemContext
    );

    expect(response.status).toBe(400);
  });

  it('rejects moving the last material farther down', async () => {
    mockFindMaterial
      .mockResolvedValueOnce({ id: 9, material_order: 2 })
      .mockResolvedValueOnce({ material_order: 2 });

    const response = await reorderMaterial(
      request('/api/courses/GEO/sessions/3/materials/9/reorder', 'PATCH', { direction: 'down' }),
      materialItemContext
    );

    expect(response.status).toBe(400);
  });

  it('reports a gap in the expected target position', async () => {
    mockFindMaterial
      .mockResolvedValueOnce({ id: 9, material_order: 2 })
      .mockResolvedValueOnce(null);

    const response = await reorderMaterial(
      request('/api/courses/GEO/sessions/3/materials/9/reorder', 'PATCH', { direction: 'up' }),
      materialItemContext
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: 'No material found at target position' });
  });

  it.each([
    ['up', [
      { id: 9, material_order: 2 },
      { id: 8, material_order: 1 },
    ]],
    ['down', [
      { id: 9, material_order: 2 },
      { material_order: 3 },
      { id: 10, material_order: 3 },
    ]],
  ])('swaps material positions moving %s', async (direction, lookups) => {
    mockFindMaterial.mockReset();
    for (const lookup of lookups) mockFindMaterial.mockResolvedValueOnce(lookup);

    const response = await reorderMaterial(
      request('/api/courses/GEO/sessions/3/materials/9/reorder', 'PATCH', { direction }),
      materialItemContext
    );

    expect(response.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
  });

  it('returns 500 when reordering fails', async () => {
    mockFindMaterial.mockRejectedValue(new Error('query failed'));

    const response = await reorderMaterial(
      request('/api/courses/GEO/sessions/3/materials/9/reorder', 'PATCH', { direction: 'up' }),
      materialItemContext
    );

    expect(response.status).toBe(500);
  });
});

describe('prepared plagiarism results route', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSession.mockResolvedValue(teacherSession);
    mockQueryLMS.mockResolvedValue([]);
    mockComparisons.mockResolvedValue([]);
  });

  it.each([
    ['missing session', null],
    ['missing user', { expires: teacherSession.expires }],
  ])('requires authentication for a %s', async (_label, session) => {
    mockSession.mockResolvedValue(session as never);

    const response = await getPlagiarismResults(
      new Request('http://localhost/api/plagiarism/results/6'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    expect(response.status).toBe(401);
  });

  it('rejects a non-numeric assignment ID', async () => {
    const response = await getPlagiarismResults(
      new Request('http://localhost/api/plagiarism/results/invalid'),
      { params: Promise.resolve({ assignmentId: 'invalid' }) }
    );

    expect(response.status).toBe(400);
  });

  it('returns an empty array when an assignment has no submissions', async () => {
    const response = await getPlagiarismResults(
      new Request('http://localhost/api/plagiarism/results/6'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    await expect(response.json()).resolves.toEqual([]);
    expect(mockComparisons).not.toHaveBeenCalled();
  });

  it('aggregates both comparison directions and every reported risk level', async () => {
    mockQueryLMS.mockResolvedValue([
      { submission_id: 'sub-1', student_id: '21', student_name: 'Student One' },
      { submission_id: 'sub-2', student_id: '22', student_name: 'Student Two' },
      { submission_id: 'sub-3', student_id: '23', student_name: 'Student Three' },
    ]);
    mockComparisons.mockResolvedValue([
      { source_submission_id: 'sub-1', target_submission_id: 'sub-2', risk_level: 'HIGH', combined_score: 0.91 },
      { source_submission_id: 'external', target_submission_id: 'sub-1', risk_level: 'MEDIUM', combined_score: 0.72 },
      { source_submission_id: 'sub-2', target_submission_id: 'external', risk_level: 'LOW', combined_score: 0.41 },
      { source_submission_id: 'sub-1', target_submission_id: 'sub-2', risk_level: 'CLEAN', combined_score: 0.1 },
      { source_submission_id: 'external-a', target_submission_id: 'external-b', risk_level: 'HIGH', combined_score: 0.99 },
    ]);

    const response = await getPlagiarismResults(
      new Request('http://localhost/api/plagiarism/results/6'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );
    const payload = await response.json();

    expect(payload).toEqual([
      expect.objectContaining({ submission_id: 'sub-1', high_risk_count: 1, medium_risk_count: 1, low_risk_count: 0, max_similarity: 0.91 }),
      expect.objectContaining({ submission_id: 'sub-2', high_risk_count: 1, medium_risk_count: 0, low_risk_count: 1, max_similarity: 0.91 }),
      expect.objectContaining({ submission_id: 'sub-3', high_risk_count: 0, medium_risk_count: 0, low_risk_count: 0, max_similarity: 0 }),
    ]);
  });

  it('returns a server error when plagiarism aggregation fails', async () => {
    mockQueryLMS.mockRejectedValue(new Error('query failed'));

    const response = await getPlagiarismResults(
      new Request('http://localhost/api/plagiarism/results/6'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Internal Server Error', details: 'query failed' });
  });
});
