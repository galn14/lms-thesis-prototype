import {
  calculateAssignmentScore,
  calculatePercentage,
  calculateQuestionScore,
  formatScore,
  getLetterGrade,
  getScoreDisplayStatus,
  needsManualGrading,
  QUESTION_TYPES,
  SCORING,
  type Question,
  type QuestionType,
} from '@/lib/scoringUtils';
import {
  filterAssignments,
  formatDateTime,
  getAssignmentStatus,
  getScoreDisplay,
  getSubmissionStatusColor,
  getUserSubmission,
  groupAssignmentsBySession,
  isOverdue,
} from '@/lib/assignmentUtils';
import type { Assignment } from '@/hooks/useAssignmentData';

const types: QuestionType[] = [
  { id: 1, name: QUESTION_TYPES.MULTIPLE_CHOICE },
  { id: 2, name: QUESTION_TYPES.TRUE_FALSE },
  { id: 3, name: QUESTION_TYPES.ESSAY },
  { id: 4, name: QUESTION_TYPES.FILE_UPLOAD },
  { id: 5, name: 'UNKNOWN' },
];

const choiceQuestion: Question = {
  id: 10,
  question_type_id: 1,
  question_text: 'Choose',
  points: 4,
  options: [
    { id: 100, option_text: 'Correct', is_correct: true },
    { id: 101, option_text: 'Wrong', is_correct: false },
  ],
};

const assignment = (overrides: Partial<Assignment> = {}): Assignment => ({
  id: 1,
  title: 'Prototype assignment',
  total_points: 10,
  attempts_allowed: 1,
  show_results: true,
  is_published: true,
  assignment_type_id: 1,
  created_date: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

describe('scoring utilities', () => {
  it('scores objective answers and rejects absent, invalid, manual, and unknown answers', () => {
    expect(SCORING.PARTIAL_CREDIT).toBe(true);
    expect(calculateQuestionScore(choiceQuestion, types[0])).toBe(0);
    expect(calculateQuestionScore({ ...choiceQuestion, options: undefined }, types[0], { question_id: 10, selected_option_id: 100 })).toBe(0);
    expect(calculateQuestionScore(choiceQuestion, types[0], { question_id: 10 })).toBe(0);
    expect(calculateQuestionScore(choiceQuestion, types[0], { question_id: 10, selected_option_id: 999 })).toBe(0);
    expect(calculateQuestionScore(choiceQuestion, types[0], { question_id: 10, selected_option_id: 101 })).toBe(0);
    expect(calculateQuestionScore(choiceQuestion, types[0], { question_id: 10, selected_option_id: 100 })).toBe(4);
    expect(calculateQuestionScore({ ...choiceQuestion, points: 0 }, types[0], { question_id: 10, selected_option_id: 100 })).toBe(0);
    expect(calculateQuestionScore({ ...choiceQuestion, question_type_id: 2 }, types[1], { question_id: 10, selected_option_id: 100 })).toBe(4);
    expect(calculateQuestionScore({ ...choiceQuestion, question_type_id: 3 }, types[2], { question_id: 10, answer_text: 'Essay' })).toBe(0);
    expect(calculateQuestionScore({ ...choiceQuestion, question_type_id: 4 }, types[3], { question_id: 10 })).toBe(0);
    expect(calculateQuestionScore({ ...choiceQuestion, question_type_id: 5 }, types[4], { question_id: 10 })).toBe(0);
  });

  it('aggregates assignment scores and identifies auto/manual grading', () => {
    const questions: Question[] = [
      choiceQuestion,
      { id: 11, question_type_id: 2, question_text: 'True?', points: 6, options: choiceQuestion.options },
      { id: 12, question_type_id: 3, question_text: 'Explain', points: 5 },
      { id: 13, question_type_id: 99, question_text: 'Missing type', points: 0 },
    ];
    const result = calculateAssignmentScore(questions, types, [
      { question_id: 10, selected_option_id: 100 },
      { question_id: 11, selected_option_id: 101 },
      { question_id: 12, answer_text: 'Answer' },
    ]);
    expect(result).toEqual({
      totalScore: 4,
      maxPossibleScore: 15,
      questionScores: [
        { questionId: 10, score: 4, maxScore: 4, isAutoGraded: true },
        { questionId: 11, score: 0, maxScore: 6, isAutoGraded: true },
        { questionId: 12, score: 0, maxScore: 5, isAutoGraded: false },
        { questionId: 13, score: 0, maxScore: 0, isAutoGraded: false },
      ],
    });
    expect(needsManualGrading(questions, types)).toBe(true);
    expect(needsManualGrading([choiceQuestion], types)).toBe(false);
  });

  it.each([
    [95, 'A'], [85, 'B'], [75, 'C'], [65, 'D'], [59, 'F'],
  ])('maps %s percent to grade %s', (percentage, grade) => {
    expect(getLetterGrade(percentage)).toBe(grade);
  });

  it('formats percentages, raw scores, and every display state', () => {
    expect(calculatePercentage(1, 0)).toBe(0);
    expect(calculatePercentage(1, 3)).toBe(33.33);
    expect(formatScore(2, 5)).toBe('2/5');
    expect(getScoreDisplayStatus(null, 10, [choiceQuestion], types)).toMatchObject({ status: 'pending', display: 'Not Submitted' });
    expect(getScoreDisplayStatus(null, 10, [{ ...choiceQuestion, question_type_id: 3 }], types)).toMatchObject({ status: 'pending', display: 'Pending Grading' });
    expect(getScoreDisplayStatus(4, 10, [{ ...choiceQuestion, question_type_id: 3 }], types)).toMatchObject({ status: 'partial', display: '4/10 (Partial)' });
    expect(getScoreDisplayStatus(9, 10, [{ ...choiceQuestion, question_type_id: 3 }], types, true)).toMatchObject({ status: 'graded', percentage: 90, letterGrade: 'A' });
  });
});

describe('assignment presentation utilities', () => {
  it('formats dates, due state, submissions, grouping, and role filtering', () => {
    expect(formatDateTime('2026-08-15T17:00:00.000Z')).toContain('2026');
    expect(isOverdue()).toBe(false);
    expect(isOverdue('2000-01-01T00:00:00.000Z')).toBe(true);
    expect(isOverdue('2999-01-01T00:00:00.000Z')).toBe(false);
    const submitted = assignment({ submissions: [{ student: { id: 7 }, total_score: null }] });
    expect(getUserSubmission(submitted, 0)).toBeNull();
    expect(getUserSubmission(assignment(), 7)).toBeNull();
    expect(getUserSubmission(submitted, 7)).toEqual(submitted.submissions![0]);
    expect(groupAssignmentsBySession([assignment({ id: 1, session_title: 'One' }), assignment({ id: 2, session_title: 'One' }), assignment({ id: 3 })])).toEqual({ One: expect.any(Array), 'Unknown Session': expect.any(Array) });
    expect(filterAssignments([assignment(), assignment({ id: 2, is_published: false })], false)).toHaveLength(1);
    expect(filterAssignments([assignment(), assignment({ id: 2, is_published: false })], true)).toHaveLength(2);
  });

  it('returns every assignment status', () => {
    expect(getAssignmentStatus(assignment({ is_published: false }), true)).toMatchObject({ text: 'Draft' });
    expect(getAssignmentStatus(assignment(), true)).toMatchObject({ text: 'Published' });
    expect(getAssignmentStatus(assignment({ due_date: '2000-01-01T00:00:00.000Z' }), false, 7)).toMatchObject({ text: 'Overdue' });
    expect(getAssignmentStatus(assignment({ due_date: '2999-01-01T00:00:00.000Z' }), false, 7)).toMatchObject({ text: 'Published' });
    expect(getAssignmentStatus(assignment({ submissions: [{ student: { id: 7 }, total_score: null }] }), false, 7)).toMatchObject({ text: 'Awaiting Review' });
    expect(getAssignmentStatus(assignment({ questions: [{ id: 1, question_type_id: 3, question_text: 'Essay', points: 10, question_type: { name: 'ESSAY' } }], submissions: [{ student: { id: 7 }, total_score: null }] }), false, 7)).toMatchObject({ text: 'Awaiting Review' });
    expect(getAssignmentStatus(assignment({ questions: [{ id: 1, question_type_id: 3, question_text: 'Essay', points: 10, question_type: { name: 'ESSAY' } }], submissions: [{ student: { id: 7 }, total_score: 0 }] }), false, 7)).toMatchObject({ text: 'Partial: 0/10 (Partial)' });
    expect(getAssignmentStatus(assignment({ questions: [], submissions: [{ student: { id: 7 }, total_score: 8 }] }), false, 7)).toMatchObject({ text: 'Scored: 8/10' });
  });

  it('formats score fallbacks and each status color', () => {
    expect(getScoreDisplay(null, 10)).toMatchObject({ status: 'pending', raw: 'Not graded' });
    expect(getScoreDisplay(8, 10)).toMatchObject({ status: 'graded', letterGrade: 'B' });
    expect(getScoreDisplay(null, 10, assignment({ questions: [] }))).toMatchObject({ status: 'pending' });
    expect(getScoreDisplay(null, 10, assignment({ questions: [{ id: 1, question_type_id: 99, question_text: 'Unknown' }] }))).toMatchObject({ status: 'pending', percentage: 'N/A', letterGrade: 'N/A' });
    expect(getSubmissionStatusColor(null, 10, 'pending')).toEqual({ color: 'text-amber-700', bg: 'bg-amber-100' });
    expect(getSubmissionStatusColor(null, 10, 'partial')).toEqual({ color: 'text-blue-700', bg: 'bg-blue-100' });
    expect(getSubmissionStatusColor(null, 10)).toEqual({ color: 'text-yellow-700', bg: 'bg-yellow-100' });
    expect(getSubmissionStatusColor(9, 10)).toEqual({ color: 'text-green-700', bg: 'bg-green-100' });
    expect(getSubmissionStatusColor(8, 10)).toEqual({ color: 'text-blue-700', bg: 'bg-blue-100' });
    expect(getSubmissionStatusColor(7, 10)).toEqual({ color: 'text-orange-700', bg: 'bg-orange-100' });
    expect(getSubmissionStatusColor(6, 10)).toEqual({ color: 'text-red-700', bg: 'bg-red-100' });
  });
});
