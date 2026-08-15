import { initDetection, processDetection } from '@/lib/plagiarism/detection';
import { queryLMS } from '@/lib/lms-db';
import { generateEmbeddingsBatch } from '@/lib/plagiarism/embeddings';
import {
  cleanupPreviousDetectionData,
  createDetection,
  insertAuditLog,
  insertChunksReturningIds,
  insertComparisons,
  insertEmbeddings,
  insertFlags,
  updateDetection,
} from '@/lib/db2/pds-repo';

// Mock dependencies
jest.mock('@/lib/lms-db', () => ({
  queryLMS: jest.fn(),
}));

jest.mock('@/lib/db2/pds-repo', () => ({
  cleanupPreviousDetectionData: jest.fn(),
  createDetection: jest.fn(),
  updateDetection: jest.fn(),
  insertChunksReturningIds: jest.fn(),
  insertEmbeddings: jest.fn(),
  insertComparisons: jest.fn(),
  insertFlags: jest.fn(),
  insertAuditLog: jest.fn(),
  findSimilarChunksLateral: jest.fn(),
}));

jest.mock('@/lib/plagiarism/embeddings', () => ({
  generateEmbeddingsBatch: jest.fn(),
}));

describe('plagiarism detection', () => {
  const mockQueryLMS = queryLMS as jest.Mock;
  const mockGenerateEmbeddingsBatch = generateEmbeddingsBatch as jest.Mock;
  const mockCreateDetection = createDetection as jest.Mock;
  const mockUpdateDetection = updateDetection as jest.Mock;
  const mockCleanup = cleanupPreviousDetectionData as jest.Mock;
  const mockInsertChunksReturningIds = insertChunksReturningIds as jest.Mock;
  const mockInsertEmbeddings = insertEmbeddings as jest.Mock;
  const mockInsertComparisons = insertComparisons as jest.Mock;
  const mockInsertFlags = insertFlags as jest.Mock;
  const mockInsertAuditLog = insertAuditLog as jest.Mock;
  const mockFindSimilarChunksLateral = require('@/lib/db2/pds-repo').findSimilarChunksLateral as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockCreateDetection.mockResolvedValue({ id: 'detection-123' });
    mockUpdateDetection.mockResolvedValue(undefined);
    mockCleanup.mockResolvedValue(undefined);
    mockInsertChunksReturningIds.mockImplementation((chunks: any) =>
      Promise.resolve(chunks.map((c: any) => ({ id: `chunk-${c.chunk_index}`, chunk_index: c.chunk_index })))
    );
    mockInsertEmbeddings.mockResolvedValue(undefined);
    mockInsertComparisons.mockResolvedValue(undefined);
    mockInsertFlags.mockResolvedValue(undefined);
    mockInsertAuditLog.mockResolvedValue(undefined);
    mockFindSimilarChunksLateral.mockResolvedValue([]);
  });

  describe('initDetection', () => {
    it('should create a detection record with all-questions scope and return the ID', async () => {
      const detectionId = await initDetection('101', 'teacher-1');

      expect(detectionId).toBe('detection-123');
      expect(mockCreateDetection).toHaveBeenCalledWith({
        assignment_id: '101',
        status: 'processing',
        created_by: 'teacher-1',
        scanned_question_ids: ['all'],
      });
    });

    it('should store specific question IDs when provided', async () => {
      await initDetection('101', 'teacher-1', ['42', '57']);

      expect(mockCreateDetection).toHaveBeenCalledWith({
        assignment_id: '101',
        status: 'processing',
        created_by: 'teacher-1',
        scanned_question_ids: ['42', '57'],
      });
    });
  });

  describe('processDetection', () => {
    beforeEach(() => {
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should run detection with per-question scoring and store per_question_scores', async () => {
      // One row per (submission, question) with question_id
      mockQueryLMS.mockResolvedValue([
        { submission_id: 'sub-1', student_id: 'student-A', question_id: 'q-1', answer_text: 'Apple banana cherry is a fruit.' },
        { submission_id: 'sub-1', student_id: 'student-A', question_id: 'q-2', answer_text: 'Second essay answer here.' },
        { submission_id: 'sub-2', student_id: 'student-B', question_id: 'q-1', answer_text: 'Apple banana cherry is a fruit.' },
        { submission_id: 'sub-2', student_id: 'student-B', question_id: 'q-2', answer_text: 'Second essay answer here.' },
      ]);

      mockGenerateEmbeddingsBatch.mockResolvedValue({
        vectors: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
        totalTokens: 20,
      });

      mockFindSimilarChunksLateral.mockResolvedValue([
        {
          source_chunk_id: 'chunk-0',
          target_chunk_id: 'chunk-2',
          source_submission_id: 'sub-1',
          target_submission_id: 'sub-2',
          source_content: 'Apple banana cherry is a fruit.',
          target_content: 'Apple banana cherry is a fruit.',
          question_index: 0,
          similarity: 1.0,
        },
        {
          source_chunk_id: 'chunk-1',
          target_chunk_id: 'chunk-3',
          source_submission_id: 'sub-1',
          target_submission_id: 'sub-2',
          source_content: 'Second essay answer here.',
          target_content: 'Second essay answer here.',
          question_index: 1,
          similarity: 1.0,
        }
      ]);

      await processDetection('detection-123', '101', 'teacher-1');

      expect(mockCleanup).toHaveBeenCalledWith(['sub-1', 'sub-2']);
      expect(mockQueryLMS).toHaveBeenCalled();
      expect(mockInsertEmbeddings).toHaveBeenCalled();

      expect(mockInsertComparisons).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            source_submission_id: 'sub-1',
            target_submission_id: 'sub-2',
            matched_chunks: expect.objectContaining({
              per_question_scores: expect.arrayContaining([
                expect.objectContaining({ question_index: 0 }),
                expect.objectContaining({ question_index: 1 }),
              ]),
            }),
          }),
        ])
      );

      expect(mockInsertFlags).toHaveBeenCalled();
      expect(mockInsertAuditLog).toHaveBeenCalled();
      expect(mockUpdateDetection).toHaveBeenCalledWith('detection-123', expect.objectContaining({
        status: 'completed',
      }));
    });

    it('should detect similarity even with moderate cosine (no 0.7 hard gate)', async () => {
      mockQueryLMS.mockResolvedValue([
        { submission_id: 'sub-1', student_id: 'student-A', question_id: 'q-1', answer_text: 'Model bahasa tidak menggunakan kata sebagai unit pemrosesan karena dua masalah utama.' },
        { submission_id: 'sub-2', student_id: 'student-B', question_id: 'q-1', answer_text: 'Model bahasa tidak menggunakan kata sebagai unit pemrosesan karena dua masalah utama.' },
      ]);

      mockGenerateEmbeddingsBatch
        .mockResolvedValueOnce({ vectors: [[1, 0, 0]], totalTokens: 10 })
        .mockResolvedValueOnce({ vectors: [[0.65, 0.76, 0]], totalTokens: 10 });

      mockFindSimilarChunksLateral.mockResolvedValue([
        {
          source_chunk_id: 'chunk-0',
          target_chunk_id: 'chunk-1',
          source_submission_id: 'sub-1',
          target_submission_id: 'sub-2',
          source_content: 'Model bahasa tidak menggunakan kata sebagai unit pemrosesan karena dua masalah utama.',
          target_content: 'Model bahasa tidak menggunakan kata sebagai unit pemrosesan karena dua masalah utama.',
          question_index: 0,
          similarity: 0.65,
        }
      ]);

      await processDetection('detection-123', '101', 'teacher-1');

      expect(mockInsertComparisons).toHaveBeenCalled();
      const comparisonArg = mockInsertComparisons.mock.calls[0][0][0];
      expect(comparisonArg.combined_score).toBeGreaterThan(0.4);
    });

    it('should handle errors gracefully and mark detection as failed', async () => {
      mockQueryLMS.mockRejectedValue(new Error('DB Connection Failed'));

      await processDetection('detection-123', '101', 'teacher-1');

      expect(mockUpdateDetection).toHaveBeenCalledWith('detection-123', {
        status: 'failed',
        error_message: 'DB Connection Failed',
      });
    });

    it('should reject malformed assignment IDs through the failure state', async () => {
      await processDetection('detection-123', 'not-a-number', 'teacher-1');
      expect(mockQueryLMS).not.toHaveBeenCalled();
      expect(mockUpdateDetection).toHaveBeenCalledWith('detection-123', {
        status: 'failed',
        error_message: 'Invalid Assignment ID format',
      });
    });

    it('should include only numeric question filters in the LMS query', async () => {
      mockQueryLMS.mockResolvedValue([]);
      await processDetection('detection-123', '101', 'teacher-1', ['12', 'invalid']);
      expect(mockQueryLMS.mock.calls[0][1]).toEqual([101, [12]]);
      expect(mockQueryLMS.mock.calls[0][0]).toContain('q.id = ANY($2::int[])');

      mockQueryLMS.mockClear();
      await processDetection('detection-123', '101', 'teacher-1', ['invalid']);
      expect(mockQueryLMS.mock.calls[0][1]).toEqual([101]);
      expect(mockQueryLMS.mock.calls[0][0]).not.toContain('q.id = ANY($2::int[])');
    });

    it('should skip short and whitespace-only submissions without calling the embedding provider', async () => {
      mockQueryLMS.mockResolvedValue([
        { submission_id: 'short', student_id: 'a', question_id: 'q1', answer_text: 'too short' },
        { submission_id: 'space', student_id: 'b', question_id: 'q1', answer_text: ' '.repeat(60) },
      ]);
      await processDetection('detection-123', '101', 'teacher-1');
      expect(mockCleanup).toHaveBeenCalledWith(['space']);
      expect(mockGenerateEmbeddingsBatch).not.toHaveBeenCalled();
      expect(mockFindSimilarChunksLateral).toHaveBeenCalledWith([], 10);
      expect(mockInsertComparisons).not.toHaveBeenCalled();
      expect(mockInsertFlags).not.toHaveBeenCalled();
    });

    it('should fail when a returned chunk cannot be mapped to its inserted row', async () => {
      mockQueryLMS.mockResolvedValue([
        { submission_id: 'sub', student_id: 'a', question_id: 'q1', answer_text: 'A sufficiently long essay answer '.repeat(3) },
      ]);
      mockInsertChunksReturningIds.mockResolvedValue([]);
      await processDetection('detection-123', '101', 'teacher-1');
      expect(mockUpdateDetection).toHaveBeenLastCalledWith('detection-123', {
        status: 'failed',
        error_message: 'Failed to map chunk index 0 to a DB row',
      });
    });

    it('should report progress every five processed submissions and use z-score scoring for a full class', async () => {
      const ids = ['sub-z', 'sub-a', 'sub-b', 'sub-c', 'sub-d', 'sub-e'];
      mockQueryLMS.mockResolvedValue(ids.flatMap((submissionId, index) => [
        {
          submission_id: submissionId,
          student_id: `student-${index}`,
          question_id: 'q1',
          answer_text: index === 0
            ? 'Distinctive geography volcano tectonic evidence '.repeat(90)
            : index === ids.length - 1
              ? 'Last synthetic geography response with repeated long evidence '.repeat(90)
            : `Independent synthetic answer number ${index} about classroom geography and regional mapping `.repeat(2),
        },
      ]));
      mockInsertChunksReturningIds.mockImplementation((chunks: any[]) => Promise.resolve(
        chunks.map(chunk => ({ id: `${chunk.submission_id}-chunk-${chunk.chunk_index}`, chunk_index: chunk.chunk_index }))
      ));
      mockGenerateEmbeddingsBatch.mockImplementation((texts: string[]) => Promise.resolve({
        vectors: texts.map((_, index) => [1, index]),
        totalTokens: texts.length,
      }));
      mockFindSimilarChunksLateral.mockResolvedValue([
        {
          source_chunk_id: 'sub-z-chunk-0', target_chunk_id: 'sub-a-chunk-0',
          source_submission_id: 'sub-z', target_submission_id: 'sub-a',
          source_content: 'source', target_content: 'target', question_index: 0, similarity: 0.9,
        },
        {
          source_chunk_id: 'sub-a-chunk-0', target_chunk_id: 'sub-z-chunk-0',
          source_submission_id: 'sub-a', target_submission_id: 'sub-z',
          source_content: 'target', target_content: 'source', question_index: 0, similarity: 0.95,
        },
        {
          source_chunk_id: 'sub-b-chunk-0', target_chunk_id: 'sub-c-chunk-0',
          source_submission_id: 'sub-b', target_submission_id: 'sub-c',
          source_content: 'low', target_content: 'low', question_index: 0, similarity: 0.4,
        },
        {
          source_chunk_id: 'sub-d-chunk-0', target_chunk_id: 'sub-e-chunk-0',
          source_submission_id: 'sub-d', target_submission_id: 'sub-e',
          source_content: 'forward', target_content: 'reverse', question_index: 0, similarity: 0.8,
        },
        {
          source_chunk_id: 'sub-e-chunk-0', target_chunk_id: 'sub-d-chunk-0',
          source_submission_id: 'sub-e', target_submission_id: 'sub-d',
          source_content: 'reverse', target_content: 'forward', question_index: 0, similarity: 0.7,
        },
      ]);

      await processDetection('detection-123', '101', 'teacher-1');

      expect(mockUpdateDetection).toHaveBeenCalledWith('detection-123', { processed_submissions: 5 });
      expect(mockInsertComparisons).toHaveBeenCalled();
      expect(mockInsertFlags).toHaveBeenCalled();
      const comparisons = mockInsertComparisons.mock.calls[0][0];
      expect(comparisons.some((comparison: any) => comparison.matched_chunks.chunks.length > 0)).toBe(true);
      expect(mockUpdateDetection).toHaveBeenLastCalledWith('detection-123', expect.objectContaining({
        status: 'completed', processed_submissions: 6,
      }));
    });

    it('should skip same-student pairs and produce empty scores for disjoint questions', async () => {
      mockQueryLMS.mockResolvedValue([
        { submission_id: 'z', student_id: 'same', question_id: 'q1', answer_text: 'First long synthetic answer about geography '.repeat(2) },
        { submission_id: 'a', student_id: 'same', question_id: 'q1', answer_text: 'Second long synthetic answer about geography '.repeat(2) },
        { submission_id: 'b', student_id: 'other', question_id: 'q2', answer_text: 'Different long synthetic answer about biology '.repeat(2) },
      ]);
      mockGenerateEmbeddingsBatch.mockImplementation((texts: string[]) => Promise.resolve({
        vectors: texts.map(() => [1, 0]), totalTokens: texts.length,
      }));
      mockInsertChunksReturningIds.mockImplementation((chunks: any[]) => Promise.resolve(
        chunks.map(chunk => ({ id: `${chunk.submission_id}-${chunk.chunk_index}`, chunk_index: chunk.chunk_index }))
      ));
      await processDetection('detection-123', '101', 'teacher-1');
      expect(mockInsertComparisons).not.toHaveBeenCalled();
      expect(mockInsertFlags).not.toHaveBeenCalled();
      expect(mockInsertAuditLog).toHaveBeenCalledWith(expect.objectContaining({
        metadata: { assignment_id: '101', matches_found: 0 },
      }));
    });
  });
});
