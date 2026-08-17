import { existsSync } from 'node:fs';
import path from 'node:path';

import { buildSyntheticDataset } from '@/lib/prototype/synthetic-dataset';
import { calculateRiskLevel } from '@/lib/plagiarism/similarity';

describe('buildSyntheticDataset', () => {
  const dataset = buildSyntheticDataset('$2b$12$synthetic-password-hash');

  it('builds the approved LMS demonstration population', () => {
    expect(dataset.academicYears).toHaveLength(1);
    expect(dataset.academicYears[0].year_name).toBe('2026/2027');
    expect(dataset.users).toHaveLength(22);
    expect(dataset.adminDetails).toHaveLength(1);
    expect(dataset.teacherDetails).toHaveLength(3);
    expect(dataset.studentDetails).toHaveLength(18);
    expect(dataset.classes).toHaveLength(2);
    expect(dataset.courses.map((course) => course.course_name)).toEqual([
      'Geografi',
      'Biologi',
      'Agama',
    ]);
    expect(dataset.classCourses).toHaveLength(6);
    expect(dataset.sessions).toHaveLength(12);
    expect(dataset.assignments).toHaveLength(6);
    expect(dataset.questions).toHaveLength(12);
    expect(dataset.submissions).toHaveLength(54);
    expect(dataset.answers).toHaveLength(108);
    expect(dataset.gradingResults).toHaveLength(108);
  });

  it('keeps a manual grading queue that still carries AI suggestions', () => {
    // The teacher grading API lists only submissions with graded_at IS NULL, so
    // an all-graded dataset makes that view permanently empty.
    const pending = dataset.submissions.filter(submission => submission.graded_at === null);
    expect(pending).toHaveLength(18);
    expect(pending.every(submission =>
      submission.status_id === 7
      && submission.total_score === null
      && submission.graded_by === null
      && submission.feedback === null
    )).toBe(true);

    const pendingIds = new Set(pending.map(submission => submission.id));
    expect(dataset.answers.filter(answer => pendingIds.has(answer.submission_id))
      .every(answer => answer.points_earned === null && answer.feedback === null)).toBe(true);

    // Graded submissions must remain, and every pending student keeps model
    // output so the teacher can compare it against their own marking.
    expect(dataset.submissions.filter(submission => submission.graded_at !== null)).toHaveLength(36);
    for (const submission of pending) {
      expect(dataset.gradingResults.some(result =>
        result.assignment_id === String(submission.assignment_id)
        && result.student_id === String(submission.student_id)
      )).toBe(true);
    }
  });

  it('covers every counted student so grading progress reads as complete', () => {
    // The dashboard renders distinct graded students over total_students, so a
    // job whose results miss a student would show partial progress.
    for (const job of dataset.gradingJobs) {
      const students = new Set(
        dataset.gradingResults
          .filter(result => result.job_id === job.id)
          .map(result => result.student_id)
      );
      expect(students.size).toBe(Number(job.total_students));
    }
  });

  it('grades the demonstration student used by the production smoke test', () => {
    const demoStudentSubmissions = dataset.submissions.filter(submission => submission.student_id === 5);
    expect(demoStudentSubmissions.length).toBeGreaterThan(0);
    expect(demoStudentSubmissions.every(submission => submission.graded_at !== null)).toBe(true);
  });

  it('uses published and deterministic usernames without storing a plaintext password', () => {
    expect(dataset.users.map((user) => user.user_name)).toEqual(
      expect.arrayContaining(['demo_admin', 'demo_teacher', 'demo_student'])
    );
    expect(dataset.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_name: 'demo_teacher_biology' }),
        expect.objectContaining({ user_name: 'demo_teacher_religion' }),
        expect.objectContaining({ user_name: 'demo_student_18' }),
      ])
    );
    expect(new Set(dataset.users.map((user) => user.password))).toEqual(
      new Set(['$2b$12$synthetic-password-hash'])
    );
  });

  it('preserves the LMS role enumeration contract', () => {
    expect(dataset.enumerations.filter((item) => item.category === 'ROLE')).toEqual([
      expect.objectContaining({ id: 1, name: 'STUDENT' }),
      expect.objectContaining({ id: 2, name: 'TEACHER' }),
      expect.objectContaining({ id: 3, name: 'ADMIN' }),
    ]);
    expect(dataset.userRoles.find((role) => role.user_id === 1)?.role_id).toBe(3);
    expect(dataset.userRoles.find((role) => role.user_id === 2)?.role_id).toBe(2);
    expect(dataset.userRoles.find((role) => role.user_id === 5)?.role_id).toBe(1);
  });

  it('prepares synthetic grading, plagiarism evidence, and LMS content', () => {
    expect(new Set(dataset.comparisons.map((comparison) => comparison.risk_level))).toEqual(
      new Set(['HIGH', 'MEDIUM', 'LOW', 'NONE'])
    );
    expect(dataset.comparisons.every((comparison) => {
      const evidence = comparison.matched_chunks as { chunks?: unknown[] };
      return Array.isArray(evidence.chunks);
    })).toBe(true);
    expect(dataset.announcements.length).toBeGreaterThan(0);
    expect(dataset.materials.length).toBeGreaterThan(0);
    expect(dataset.forums.length).toBeGreaterThan(0);
    expect(dataset.forumPosts.length).toBeGreaterThan(0);
  });

  it('provides finite zero-based plagiarism scores in the UI evidence shape', () => {
    for (const comparison of dataset.comparisons) {
      expect(calculateRiskLevel(Number(comparison.combined_score))).toBe(comparison.risk_level);
      const evidence = comparison.matched_chunks as {
        chunks: Array<{ question_index: number }>;
        per_question_scores: Array<{
          question_index: number;
          semantic_score: number;
          lexical_score: number;
          combined_score: number;
        }>;
      };
      expect(evidence.chunks.every((chunk) => chunk.question_index === 0)).toBe(true);
      expect(evidence.per_question_scores).toHaveLength(1);
      expect(evidence.per_question_scores[0]).toEqual({
        question_index: 0,
        semantic_score: comparison.semantic_score,
        lexical_score: comparison.lexical_score,
        combined_score: comparison.combined_score,
      });
      expect(Object.values(evidence.per_question_scores[0]).every(Number.isFinite)).toBe(true);
    }
  });

  it('uses only runtime-supported plagiarism flag statuses', () => {
    expect(new Set(dataset.flags.map((flag) => flag.status))).toEqual(
      new Set(['pending', 'reviewed'])
    );
    expect(dataset.flags.filter((flag) => flag.reviewed === false)).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'pending' })])
    );
  });

  it('only references local material assets that exist in the repository', () => {
    const localPaths = new Set(dataset.resources.map((resource) => String(resource.file_url)));

    for (const localPath of localPaths) {
      expect(localPath.startsWith('/prototype-assets/')).toBe(true);
      expect(existsSync(path.join(process.cwd(), 'public', localPath))).toBe(true);
    }
  });
});
