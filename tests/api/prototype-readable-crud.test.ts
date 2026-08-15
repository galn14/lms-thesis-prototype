import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import {
  getGradingResultsByJobAndStudent,
  getLatestCompletedJobByAssignment,
} from '@/lib/db2/acs-repo';
import { getComparisonsBySubmissionIds } from '@/lib/db2/pds-repo';
import { queryLMS } from '@/lib/lms-db';
import { getOpenAI } from '@/lib/openai';
import { prisma } from '@/lib/prisma';
import { GET as getGradingResults } from '@/app/api/ai-grading/results/[assignmentId]/route';
import { GET as getPlagiarismResults } from '@/app/api/plagiarism/results/[assignmentId]/route';
import {
  GET as getMaterials,
  POST as createMaterial,
} from '@/app/api/courses/[code]/sessions/[sessionId]/materials/route';
import {
  DELETE as deleteMaterial,
  PUT as updateMaterial,
} from '@/app/api/courses/[code]/sessions/[sessionId]/materials/[id]/route';
import {
  GET as getForumPosts,
  POST as createForumPost,
} from '@/app/api/courses/[code]/forums/[forumId]/posts/route';

jest.mock('next-auth', () => ({
  getServerSession: jest.fn(),
}));

jest.mock('@/lib/openai', () => ({
  getOpenAI: jest.fn(),
}));

jest.mock('@/lib/db2/acs-repo', () => ({
  getGradingResultsByJobAndStudent: jest.fn(),
  getLatestCompletedJobByAssignment: jest.fn(),
}));

jest.mock('@/lib/db2/pds-repo', () => ({
  getComparisonsBySubmissionIds: jest.fn(),
}));

jest.mock('@/lib/lms-db', () => ({
  queryLMS: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $executeRaw: jest.fn(),
    forums: { findUnique: jest.fn() },
    forum_attachments: { create: jest.fn() },
    forum_posts: {
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
    },
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

const mockGetServerSession = getServerSession as jest.MockedFunction<typeof getServerSession>;
const mockLatestJob = getLatestCompletedJobByAssignment as jest.Mock;
const mockGradingResults = getGradingResultsByJobAndStudent as jest.Mock;
const mockQueryLMS = queryLMS as jest.Mock;
const mockComparisons = getComparisonsBySubmissionIds as jest.Mock;

function demoSession() {
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

describe('prototype read-only results and database CRUD regressions', () => {
  const originalPrototypeMode = process.env.PROTOTYPE_MODE;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROTOTYPE_MODE = 'true';
    mockGetServerSession.mockResolvedValue(demoSession());
  });

  afterAll(() => {
    if (originalPrototypeMode === undefined) {
      delete process.env.PROTOTYPE_MODE;
    } else {
      process.env.PROTOTYPE_MODE = originalPrototypeMode;
    }
  });

  it('keeps prepared grading results readable without initializing a provider', async () => {
    mockLatestJob.mockResolvedValue({
      id: 'job-demo',
      assignment_id: '6',
      completed_at: '2026-08-14T17:00:00.000Z',
    });
    mockGradingResults.mockResolvedValue([{ student_id: '21', score: 88 }]);

    const response = await getGradingResults(
      new NextRequest('http://localhost/api/ai-grading/results/6?studentId=21'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        job: { id: 'job-demo', assignment_id: '6' },
        results: [{ student_id: '21', score: 88 }],
      },
    });
    expect(getOpenAI).not.toHaveBeenCalled();
  });

  it('keeps prepared plagiarism results readable without initializing a provider', async () => {
    mockQueryLMS.mockResolvedValue([
      { submission_id: 'sub-1', student_id: '21', student_name: 'Demo Student' },
    ]);
    mockComparisons.mockResolvedValue([
      {
        source_submission_id: 'sub-1',
        target_submission_id: 'sub-2',
        risk_level: 'HIGH',
        combined_score: 0.91,
      },
    ]);

    const response = await getPlagiarismResults(
      new Request('http://localhost/api/plagiarism/results/6'),
      { params: Promise.resolve({ assignmentId: '6' }) }
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      expect.objectContaining({
        submission_id: 'sub-1',
        high_risk_count: 1,
        max_similarity: 0.91,
      }),
    ]);
    expect(getOpenAI).not.toHaveBeenCalled();
  });

  it('keeps database-only material create, read, update, and delete usable', async () => {
    (prisma.sessions.findFirst as jest.Mock).mockResolvedValue({ id: 1 });
    (prisma.materials.findMany as jest.Mock).mockResolvedValue([
      { id: 10, session_id: 1, title: 'Prepared Material', material_order: 1 },
    ]);
    (prisma.materials.findFirst as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 10, session_id: 1, title: 'Prepared Material', material_order: 1 })
      .mockResolvedValueOnce({ id: 10, session_id: 1, title: 'Updated Material', material_order: 1 });
    (prisma.materials.create as jest.Mock).mockResolvedValue({
      id: 10,
      session_id: 1,
      title: 'Prepared Material',
      content: 'Synthetic content',
      material_order: 1,
    });
    (prisma.materials.update as jest.Mock).mockResolvedValue({
      id: 10,
      title: 'Updated Material',
      content: 'Updated synthetic content',
    });
    (prisma.materials.delete as jest.Mock).mockResolvedValue({ id: 10 });

    const routeContext = { params: Promise.resolve({ code: 'GEO', sessionId: '1' }) };
    const createResponse = await createMaterial(
      new NextRequest('http://localhost/api/courses/GEO/sessions/1/materials', {
        method: 'POST',
        body: JSON.stringify({ title: 'Prepared Material', content: 'Synthetic content' }),
      }),
      routeContext
    );
    const readResponse = await getMaterials(
      new NextRequest('http://localhost/api/courses/GEO/sessions/1/materials'),
      routeContext
    );
    const updateResponse = await updateMaterial(
      new NextRequest('http://localhost/api/courses/GEO/sessions/1/materials/10', {
        method: 'PUT',
        body: JSON.stringify({ title: 'Updated Material', content: 'Updated synthetic content' }),
      }),
      { params: Promise.resolve({ code: 'GEO', sessionId: '1', id: '10' }) }
    );
    const deleteResponse = await deleteMaterial(
      new NextRequest('http://localhost/api/courses/GEO/sessions/1/materials/10', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ code: 'GEO', sessionId: '1', id: '10' }) }
    );

    expect([createResponse.status, readResponse.status, updateResponse.status, deleteResponse.status]).toEqual([
      200,
      200,
      200,
      200,
    ]);
    expect(prisma.materials.create).toHaveBeenCalledTimes(1);
    expect(prisma.materials.update).toHaveBeenCalledTimes(1);
    expect(prisma.materials.delete).toHaveBeenCalledTimes(1);
    expect(getOpenAI).not.toHaveBeenCalled();
  });

  it('keeps attachment-free forum read and create operations usable', async () => {
    (prisma.forums.findUnique as jest.Mock).mockResolvedValue({ id: 7, title: 'Synthetic Forum' });
    (prisma.forum_posts.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.forum_posts.count as jest.Mock).mockResolvedValue(0);
    (prisma.forum_posts.create as jest.Mock).mockResolvedValue({
      id: 8,
      title: 'Prototype discussion',
      content: 'Database-only forum content',
      content_type: 'plaintext',
      created_at: '2026-08-15T00:00:00.000Z',
      updated_at: '2026-08-15T00:00:00.000Z',
      app_user: { id: 2, nama_lengkap: 'Demo Teacher', profile_picture_url: null },
      forum_attachments: [],
    });

    const context = { params: Promise.resolve({ code: 'GEO', forumId: '7' }) };
    const readResponse = await getForumPosts(
      new NextRequest('http://localhost/api/courses/GEO/forums/7/posts'),
      context
    );
    const createResponse = await createForumPost(
      new NextRequest('http://localhost/api/courses/GEO/forums/7/posts', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Prototype discussion',
          content: 'Database-only forum content',
          attachments: [],
        }),
      }),
      context
    );

    expect(readResponse.status).toBe(200);
    expect(createResponse.status).toBe(200);
    expect(prisma.forum_posts.create).toHaveBeenCalledTimes(1);
    expect(prisma.forum_attachments.create).not.toHaveBeenCalled();
    expect(getOpenAI).not.toHaveBeenCalled();
  });
});
