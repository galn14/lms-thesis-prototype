import {
  buildClassScopedCourseQuery,
  buildPeopleQuery,
  selectClassCourse,
  selectInitialSessionId,
} from './course-class-selection';

const classCourses = [
  {
    class_id: 10,
    class_name: 'Grade 10 Math',
    sessions: [
      { id: 101, title: 'Algebra' },
      { id: 102, title: 'Statistics' },
    ],
  },
  {
    class_id: 11,
    class_name: 'Grade 11 Math',
    sessions: [{ id: 201, title: 'Calculus' }],
  },
];

describe('course class selection', () => {
  it('passes classId through course card links when available', () => {
    expect(buildClassScopedCourseQuery('MATH101', 10)).toEqual({
      code: 'MATH101',
      classId: 10,
    });
  });

  it('omits classId from course card links when unavailable', () => {
    expect(buildClassScopedCourseQuery('MATH101', null)).toEqual({
      code: 'MATH101',
    });
  });

  it('also omits classId when it is undefined', () => {
    expect(buildClassScopedCourseQuery('MATH101')).toEqual({ code: 'MATH101' });
  });

  it('selects the class course from the classId route parameter first', () => {
    expect(selectClassCourse(classCourses, '11', 101)?.class_name).toBe('Grade 11 Math');
  });

  it('falls back to the class course containing the active session', () => {
    expect(selectClassCourse(classCourses, null, 102)?.class_name).toBe('Grade 10 Math');
  });

  it('falls back to the first class for missing, empty, or malformed route parameters', () => {
    expect(selectClassCourse(null, '10', 101)).toBeUndefined();
    expect(selectClassCourse([], '10', 101)).toBeUndefined();
    expect(selectClassCourse(classCourses, '', null)).toBe(classCourses[0]);
    expect(selectClassCourse(classCourses, 'not-a-number', null)).toBe(classCourses[0]);
    expect(selectClassCourse(classCourses, '99', null)).toBe(classCourses[0]);
    expect(selectClassCourse(classCourses, null, 999)).toBe(classCourses[0]);
  });

  it('handles class courses with absent session collections', () => {
    expect(selectClassCourse([{ class_id: 12, sessions: null }, ...classCourses], null, 101)).toBe(classCourses[0]);
  });

  it('chooses the first session from the selected class course when no sessionId is provided', () => {
    expect(selectInitialSessionId(classCourses, '11', null)).toBe(201);
  });

  it('keeps an explicit sessionId when provided', () => {
    expect(selectInitialSessionId(classCourses, '11', '102')).toBe(102);
  });

  it('falls back from malformed or absent session parameters and returns null without sessions', () => {
    expect(selectInitialSessionId(classCourses, '10', 'bad')).toBe(101);
    expect(selectInitialSessionId(undefined, null, null)).toBeNull();
    expect(selectInitialSessionId([{ class_id: 12, sessions: [] }], '12', null)).toBeNull();
  });

  it('adds classId to people API queries', () => {
    expect(buildPeopleQuery('teacher', 10).toString()).toBe('type=teacher&classId=10');
  });

  it('omits an absent classId for every people query type', () => {
    expect(buildPeopleQuery('students').toString()).toBe('type=students');
    expect(buildPeopleQuery('all', null).toString()).toBe('type=all');
  });
});
