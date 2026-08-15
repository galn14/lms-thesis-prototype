import * as repo from '@/lib/db2/pds-repo';
import { queryAux } from '@/lib/aux-db';

jest.mock('@/lib/aux-db', () => ({ queryAux: jest.fn() }));

const mockedQuery = queryAux as jest.Mock;

describe('PDS repository query contracts', () => {
  beforeEach(() => {
    mockedQuery.mockReset();
    mockedQuery.mockResolvedValue([]);
  });

  it('creates and updates a detection using positional parameters', async () => {
    mockedQuery.mockResolvedValueOnce([{ id: 'det-1' }]).mockResolvedValueOnce([]);
    await expect(repo.createDetection({
      assignment_id: '10', status: 'processing', created_by: '7', scanned_question_ids: ['1'],
    })).resolves.toEqual({ id: 'det-1' });
    expect(mockedQuery.mock.calls[0][1]).toEqual(['10', 'processing', '7', ['1']]);

    await repo.updateDetection('det-1', {
      status: 'completed', completed_at: null, total_submissions: 3,
      processed_submissions: 3, error_message: undefined,
    });
    expect(mockedQuery.mock.calls[1][0]).toContain('status = $2, completed_at = $3, total_submissions = $4, processed_submissions = $5');
    expect(mockedQuery.mock.calls[1][1]).toEqual(['det-1', 'completed', null, 3, 3]);
    await expect(repo.updateDetection('det-1', {})).rejects.toThrow('No fields provided for update');
  });

  it('returns detection rows or null when no row exists', async () => {
    mockedQuery.mockResolvedValueOnce([{ status: 'done' }]).mockResolvedValueOnce([]);
    await expect(repo.getDetectionStatus('det-1')).resolves.toEqual({ status: 'done' });
    await expect(repo.getDetectionStatus('missing')).resolves.toBeNull();
  });

  it('bulk inserts chunks and returns early for an empty batch', async () => {
    await expect(repo.insertChunksReturningIds([])).resolves.toEqual([]);
    expect(mockedQuery).not.toHaveBeenCalled();

    mockedQuery.mockResolvedValue([{ id: 'chunk-1', chunk_index: 0 }]);
    const rows = [{ submission_id: 'sub-1', content: 'answer', chunk_index: 0,
      question_index: 2, start_char: 0, end_char: 5, token_count: 2 }];
    await expect(repo.insertChunksReturningIds(rows)).resolves.toEqual([{ id: 'chunk-1', chunk_index: 0 }]);
    expect(mockedQuery.mock.calls[0][0]).toContain('VALUES ($1, $2, $3, $4, $5, $6, $7)');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['sub-1', 'answer', 0, 2, 0, 5, 2]);
  });

  it('serializes finite vectors and rejects invalid vector values', async () => {
    await repo.insertEmbedding('chunk-1', [0.1, 2], 'model');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['chunk-1', '[0.1,2]', 'model']);
    await expect(repo.insertEmbedding('chunk-1', [Number.NaN], 'model')).rejects.toThrow('non-finite');
    await expect(repo.insertEmbedding('chunk-1', [Number.POSITIVE_INFINITY], 'model')).rejects.toThrow('non-finite');
  });

  it('bulk inserts vector embeddings with casts and supports empty batches', async () => {
    await expect(repo.insertEmbeddings([])).resolves.toBeUndefined();
    expect(mockedQuery).not.toHaveBeenCalled();
    await repo.insertEmbeddings([
      { chunk_id: 'c1', vector: [1, 0], model: 'm' },
      { chunk_id: 'c2', vector: [0, 1], model: 'm' },
    ]);
    expect(mockedQuery.mock.calls[0][0]).toContain('($1, $2::vector, $3), ($4, $5::vector, $6)');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['c1', '[1,0]', 'm', 'c2', '[0,1]', 'm']);
  });

  it('bulk inserts comparisons with JSON evidence and supports empty batches', async () => {
    await expect(repo.insertComparisons([])).resolves.toBeUndefined();
    expect(mockedQuery).not.toHaveBeenCalled();
    await repo.insertComparisons([{
      id: 'cmp', source_submission_id: 'a', target_submission_id: 'b', semantic_score: .8,
      lexical_score: .7, combined_score: .75, risk_level: 'MEDIUM', matched_chunks: { q: 1 },
      compared_at: '2026-01-01',
    }]);
    expect(mockedQuery.mock.calls[0][0]).toContain('$8::jsonb');
    expect(mockedQuery.mock.calls[0][1][7]).toBe('{"q":1}');
  });

  it('bulk inserts flags and supports empty batches', async () => {
    await expect(repo.insertFlags([])).resolves.toBeUndefined();
    expect(mockedQuery).not.toHaveBeenCalled();
    await repo.insertFlags([{ comparison_id: 'cmp', submission_id: 'a', status: 'pending', is_false_positive: false }]);
    expect(mockedQuery.mock.calls[0][0]).toContain('ON CONFLICT DO NOTHING');
    expect(mockedQuery.mock.calls[0][1]).toEqual(['cmp', 'a', 'pending', false]);
  });

  it('retrieves comparisons by one or many submission IDs', async () => {
    await expect(repo.getComparisonsBySubmissionIds([])).resolves.toEqual([]);
    expect(mockedQuery).not.toHaveBeenCalled();
    mockedQuery.mockResolvedValueOnce([{ id: 'many' }]).mockResolvedValueOnce([{ id: 'one' }]);
    await expect(repo.getComparisonsBySubmissionIds(['a', 'b'])).resolves.toEqual([{ id: 'many' }]);
    expect(mockedQuery.mock.calls[0][1]).toEqual([['a', 'b']]);
    await expect(repo.getComparisonsBySubmissionId('a')).resolves.toEqual([{ id: 'one' }]);
    expect(mockedQuery.mock.calls[1][1]).toEqual(['a']);
  });

  it.each([
    ['getComparisonById', ['cmp']],
    ['getFlagByComparisonAndSubmission', ['cmp', 'sub']],
    ['getLatestDetectionForAssignment', ['assignment']],
  ] as const)('%s returns a row or null', async (method, args) => {
    mockedQuery.mockResolvedValueOnce([{ id: 'found' }]).mockResolvedValueOnce([]);
    const call = repo[method] as (...values: string[]) => Promise<unknown>;
    await expect(call(...args)).resolves.toEqual({ id: 'found' });
    await expect(call(...args)).resolves.toBeNull();
  });

  it('updates a flag and validates non-empty update fields', async () => {
    mockedQuery.mockResolvedValueOnce([{ id: 'flag', reviewed: true }]).mockResolvedValueOnce([]);
    await expect(repo.updateFlag('flag', { reviewed: true, teacher_notes: null })).resolves.toEqual({ id: 'flag', reviewed: true });
    expect(mockedQuery.mock.calls[0][1]).toEqual(['flag', true, null]);
    await expect(repo.updateFlag('flag', { status: 'closed' })).resolves.toBeNull();
    await expect(repo.updateFlag('flag', {})).rejects.toThrow('No fields provided for update');
  });

  it('inserts teacher actions with explicit and default notes', async () => {
    await repo.insertTeacherAction({ flag_id: 'f', teacher_id: 't', action: 'confirm', notes: 'copied' });
    await repo.insertTeacherAction({ flag_id: 'f', teacher_id: 't', action: 'dismiss' });
    expect(mockedQuery.mock.calls[0][1]).toEqual(['f', 't', 'confirm', 'copied']);
    expect(mockedQuery.mock.calls[1][1]).toEqual(['f', 't', 'dismiss', null]);
  });

  it('inserts audit metadata and defaults omitted metadata to an object', async () => {
    await repo.insertAuditLog({ user_id: 'u', action: 'scan', entity_type: 'assignment', entity_id: 'a', metadata: { count: 2 } });
    await repo.insertAuditLog({ user_id: 'u', action: 'scan', entity_type: 'assignment', entity_id: 'a' });
    expect(mockedQuery.mock.calls[0][1][4]).toBe('{"count":2}');
    expect(mockedQuery.mock.calls[1][1][4]).toBe('{}');
  });

  it('cleans dependent data in foreign-key order and skips an empty scope', async () => {
    await repo.cleanupPreviousDetectionData([]);
    expect(mockedQuery).not.toHaveBeenCalled();
    await repo.cleanupPreviousDetectionData(['a', 'b']);
    expect(mockedQuery).toHaveBeenCalledTimes(4);
    expect(mockedQuery.mock.calls.map(call => call[0])).toEqual([
      expect.stringContaining('DELETE FROM pds_flags'),
      expect.stringContaining('DELETE FROM pds_comparisons'),
      expect.stringContaining('DELETE FROM pds_embeddings'),
      expect.stringContaining('DELETE FROM pds_chunks'),
    ]);
  });

  it('constructs the lateral similarity query with a supplied or default limit', async () => {
    await expect(repo.findSimilarChunksLateral(['only'])).resolves.toEqual([]);
    expect(mockedQuery).not.toHaveBeenCalled();
    mockedQuery.mockResolvedValueOnce([{ similarity: .9 }]).mockResolvedValueOnce([]);
    await expect(repo.findSimilarChunksLateral(['a', 'b'], 3)).resolves.toEqual([{ similarity: .9 }]);
    expect(mockedQuery.mock.calls[0][0]).toContain('CROSS JOIN LATERAL');
    expect(mockedQuery.mock.calls[0][1]).toEqual([['a', 'b'], 3]);
    await repo.findSimilarChunksLateral(['a', 'b']);
    expect(mockedQuery.mock.calls[1][1]).toEqual([['a', 'b'], 5]);
  });
});
