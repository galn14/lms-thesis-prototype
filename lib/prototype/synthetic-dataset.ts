export type SeedRow = Record<string, unknown>;

export interface SyntheticDataset {
  enumerations: SeedRow[];
  users: SeedRow[];
  userRoles: SeedRow[];
  adminDetails: SeedRow[];
  teacherDetails: SeedRow[];
  studentDetails: SeedRow[];
  profiles: SeedRow[];
  academicYears: SeedRow[];
  classes: SeedRow[];
  courses: SeedRow[];
  classCourses: SeedRow[];
  enrollments: SeedRow[];
  sessions: SeedRow[];
  assignments: SeedRow[];
  questions: SeedRow[];
  submissions: SeedRow[];
  answers: SeedRow[];
  announcements: SeedRow[];
  materials: SeedRow[];
  resources: SeedRow[];
  forums: SeedRow[];
  forumPosts: SeedRow[];
  forumReplies: SeedRow[];
  acsAssignments: SeedRow[];
  gradingJobs: SeedRow[];
  gradingResults: SeedRow[];
  detections: SeedRow[];
  comparisons: SeedRow[];
  flags: SeedRow[];
}

const BASE_TIME = new Date('2026-07-13T00:00:00.000Z');
const YEAR_END = new Date('2027-06-25T00:00:00.000Z');

function stableUuid(prefix: number, id: number): string {
  return `${prefix.toString().padStart(8, '0')}-0000-4000-8000-${id.toString().padStart(12, '0')}`;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

function studentAnswer(courseName: string, studentNumber: number, questionNumber: number): string {
  const subjects: Record<string, string[]> = {
    Geografi: [
      'Interaksi atmosfer, hidrosfer, dan aktivitas manusia membentuk pola wilayah yang berbeda.',
      'Mitigasi dilakukan melalui pemetaan risiko, edukasi warga, dan tata ruang berbasis daya dukung.',
    ],
    Biologi: [
      'Keanekaragaman gen, spesies, dan ekosistem saling mendukung kestabilan lingkungan.',
      'Pengamatan terkontrol membandingkan variabel sambil mempertahankan kondisi lain tetap sama.',
    ],
    Agama: [
      'Martabat manusia diwujudkan melalui kepedulian, kejujuran, dan tanggung jawab sosial.',
      'Refleksi etis membantu menilai dampak pilihan terhadap diri sendiri dan sesama.',
    ],
  };
  const base = subjects[courseName][questionNumber - 1];
  return `${base} Contoh siswa sintetis ${studentNumber.toString().padStart(2, '0')} menekankan alasan, contoh, dan kesimpulan yang dapat ditinjau guru.`;
}

export function buildSyntheticDataset(passwordHash: string): SyntheticDataset {
  const enumerations: SeedRow[] = [
    { id: 1, name: 'STUDENT', alt_name: 'Siswa', category: 'ROLE', is_default: true },
    { id: 2, name: 'TEACHER', alt_name: 'Guru', category: 'ROLE', is_default: false },
    { id: 3, name: 'ADMIN', alt_name: 'Administrator', category: 'ROLE', is_default: false },
    { id: 4, name: 'ESSAY', alt_name: 'Esai', category: 'QUESTION_TYPE', is_default: true },
    { id: 5, name: 'ASSIGNMENT', alt_name: 'Tugas', category: 'ASSIGNMENT_TYPE', is_default: true },
    { id: 6, name: 'GRADED', alt_name: 'Dinilai', category: 'SUBMISSION_STATUS', is_default: true },
    { id: 7, name: 'SUBMITTED', alt_name: 'Dikumpulkan', category: 'SUBMISSION_STATUS', is_default: false },
  ];

  const users: SeedRow[] = [
    {
      id: 1,
      email: 'demo.admin@example.invalid',
      password: passwordHash,
      user_name: 'demo_admin',
      nama_lengkap: 'Admin Demonstrasi',
    },
    {
      id: 2,
      email: 'demo.teacher@example.invalid',
      password: passwordHash,
      user_name: 'demo_teacher',
      nama_lengkap: 'Guru Geografi Demonstrasi',
    },
    {
      id: 3,
      email: 'demo.teacher.biology@example.invalid',
      password: passwordHash,
      user_name: 'demo_teacher_biology',
      nama_lengkap: 'Guru Biologi Demonstrasi',
    },
    {
      id: 4,
      email: 'demo.teacher.religion@example.invalid',
      password: passwordHash,
      user_name: 'demo_teacher_religion',
      nama_lengkap: 'Guru Agama Demonstrasi',
    },
  ];

  for (let studentNumber = 1; studentNumber <= 18; studentNumber += 1) {
    const suffix = studentNumber.toString().padStart(2, '0');
    users.push({
      id: studentNumber + 4,
      email: `demo.student.${suffix}@example.invalid`,
      password: passwordHash,
      user_name: studentNumber === 1 ? 'demo_student' : `demo_student_${suffix}`,
      nama_lengkap: `Siswa Sintetis ${suffix}`,
    });
  }

  const userRoles = users.map((user) => ({
    id: user.id,
    role_id: user.id === 1 ? 3 : Number(user.id) <= 4 ? 2 : 1,
    user_id: user.id,
  }));
  const adminDetails = [{ id: 1, user_id: 1, kode_admin: 'DEMO-ADMIN-01' }];
  const teacherDetails = [2, 3, 4].map((userId, index) => ({
    id: index + 1,
    user_id: userId,
    kode_guru: `DEMO-GURU-${(index + 1).toString().padStart(2, '0')}`,
    niy: `SYNTHETIC-${202600 + index + 1}`,
  }));
  const studentDetails = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    user_id: index + 5,
    nis: `DEMO-${(index + 1).toString().padStart(4, '0')}`,
    nisn: `SYNTHETIC-${(index + 1).toString().padStart(4, '0')}`,
  }));
  const profiles = users.map((user) => ({
    id: user.id,
    user_id: user.id,
    tmp_lahir: 'Surabaya',
    agama: Number(user.id) % 3 === 0 ? 'Kristen' : 'Katolik',
  }));

  const academicYears = [{
    id: 1,
    year_name: '2026/2027',
    start_date: BASE_TIME,
    end_date: YEAR_END,
    is_active: true,
  }];
  const classes = [
    { id: 1, class_name: 'XI-A Prototype', grade_level: 'XI', year_id: 1, wali_kelas: 2 },
    { id: 2, class_name: 'XI-B Prototype', grade_level: 'XI', year_id: 1, wali_kelas: 3 },
  ];
  const courses = [
    { id: 1, course_code: 'DEMO-GEO', course_name: 'Geografi', description: 'Kajian ruang dan lingkungan dengan data sintetis.' },
    { id: 2, course_code: 'DEMO-BIO', course_name: 'Biologi', description: 'Kajian makhluk hidup dengan data sintetis.' },
    { id: 3, course_code: 'DEMO-AGM', course_name: 'Agama', description: 'Refleksi nilai dan etika dengan data sintetis.' },
  ];

  const classCourses: SeedRow[] = [];
  for (const course of courses) {
    for (const schoolClass of classes) {
      const courseId = Number(course.id);
      const classId = Number(schoolClass.id);
      classCourses.push({
        id: (courseId - 1) * 2 + classId,
        class_id: classId,
        course_id: courseId,
        teacher_id: courseId + 1,
        start_date: BASE_TIME,
        end_date: YEAR_END,
        is_active: true,
        syllabus: `Silabus sintetis ${course.course_name} untuk ${schoolClass.class_name}.`,
      });
    }
  }

  const enrollments: SeedRow[] = [];
  let enrollmentId = 1;
  for (const classCourse of classCourses) {
    const classId = Number(classCourse.class_id);
    const firstStudentId = classId === 1 ? 5 : 14;
    for (let offset = 0; offset < 9; offset += 1) {
      enrollments.push({
        id: enrollmentId,
        class_course_id: classCourse.id,
        student_id: firstStudentId + offset,
        roll_number: offset + 1,
        enrollment_date: BASE_TIME,
      });
      enrollmentId += 1;
    }
  }

  const sessions: SeedRow[] = [];
  for (const classCourse of classCourses) {
    const classCourseId = Number(classCourse.id);
    for (let sessionNumber = 1; sessionNumber <= 2; sessionNumber += 1) {
      const id = (classCourseId - 1) * 2 + sessionNumber;
      sessions.push({
        id,
        class_course_id: classCourseId,
        title: `Sesi ${sessionNumber} — ${courses[Math.ceil(classCourseId / 2) - 1].course_name}`,
        description: 'Sesi pembelajaran sintetis untuk demonstrasi prototype.',
        session_number: sessionNumber,
        start_time: addDays(BASE_TIME, id * 7),
        end_time: new Date(addDays(BASE_TIME, id * 7).getTime() + 5_400_000),
        is_completed: id <= 8,
      });
    }
  }

  const assignments: SeedRow[] = [];
  const questions: SeedRow[] = [];
  for (const classCourse of classCourses) {
    const assignmentId = Number(classCourse.id);
    const course = courses[Math.ceil(assignmentId / 2) - 1];
    assignments.push({
      id: assignmentId,
      session_id: (assignmentId - 1) * 2 + 1,
      assignment_type_id: 5,
      title: `Tugas Esai ${course.course_name} ${assignmentId % 2 === 1 ? 'XI-A' : 'XI-B'}`,
      description: 'Tugas demonstrasi; seluruh jawaban, nilai, dan identitas bersifat sintetis.',
      instructions: 'Jawab dua pertanyaan dengan argumentasi ringkas dan contoh yang relevan.',
      total_points: 100,
      due_date: addDays(BASE_TIME, 45 + assignmentId),
      start_date: addDays(BASE_TIME, 30 + assignmentId),
      attempts_allowed: 1,
      show_results: true,
      is_published: true,
      created_by: Number(course.id) + 1,
    });
    questions.push(
      {
        id: (assignmentId - 1) * 2 + 1,
        assignment_id: assignmentId,
        question_type_id: 4,
        question_text: `Jelaskan konsep utama ${course.course_name} dan kaitannya dengan kehidupan sehari-hari.`,
        points: 50,
        order_number: 1,
        required: true,
      },
      {
        id: (assignmentId - 1) * 2 + 2,
        assignment_id: assignmentId,
        question_type_id: 4,
        question_text: `Analisis satu contoh penerapan ${course.course_name} secara bertanggung jawab.`,
        points: 50,
        order_number: 2,
        required: true,
      }
    );
  }

  const submissions: SeedRow[] = [];
  const answers: SeedRow[] = [];
  const gradingResults: SeedRow[] = [];
  const gradingJobs: SeedRow[] = [];
  const acsAssignments: SeedRow[] = [];
  let submissionId = 1;
  let answerId = 1;
  for (const assignment of assignments) {
    const assignmentId = Number(assignment.id);
    const classId = assignmentId % 2 === 1 ? 1 : 2;
    const firstStudentId = classId === 1 ? 5 : 14;
    const course = courses[Math.ceil(assignmentId / 2) - 1];
    const teacherId = Number(course.id) + 1;
    const jobId = stableUuid(20_000_000, assignmentId);
    acsAssignments.push({
      id: stableUuid(10_000_000, assignmentId),
      assignment_id: String(assignmentId),
      course_id: String(course.id),
      vector_store_id: `prototype-disabled-${assignmentId}`,
      rubric: { criteria: ['ketepatan konsep', 'argumentasi', 'contoh'], synthetic: true },
      created_by: String(teacherId),
      status: 'completed',
      rerun_grading: false,
    });
    gradingJobs.push({
      id: jobId,
      assignment_id: String(assignmentId),
      total_students: 9,
      status: 'completed',
      completed_at: addDays(BASE_TIME, 60 + assignmentId),
    });

    for (let offset = 0; offset < 9; offset += 1) {
      const studentId = firstStudentId + offset;
      const studentNumber = studentId - 4;
      const firstScore = 38 + ((assignmentId + offset) % 11);
      const secondScore = 37 + ((assignmentId * 2 + offset) % 12);
      const totalScore = firstScore + secondScore;
      const currentSubmissionId = submissionId;
      submissions.push({
        id: currentSubmissionId,
        assignment_id: assignmentId,
        student_id: studentId,
        attempt_number: 1,
        submitted_at: addDays(BASE_TIME, 44 + assignmentId),
        status_id: 6,
        total_score: totalScore,
        feedback: 'Hasil demonstrasi sintetis. Tinjau ketepatan konsep dan kekuatan contoh.',
        graded_by: teacherId,
        graded_at: addDays(BASE_TIME, 60 + assignmentId),
      });

      for (let questionNumber = 1; questionNumber <= 2; questionNumber += 1) {
        const questionId = (assignmentId - 1) * 2 + questionNumber;
        const score = questionNumber === 1 ? firstScore : secondScore;
        answers.push({
          id: answerId,
          submission_id: currentSubmissionId,
          question_id: questionId,
          answer_text: studentAnswer(String(course.course_name), studentNumber, questionNumber),
          points_earned: score,
          feedback: 'Umpan balik sintetis: konsep relevan; tambahkan bukti yang lebih spesifik.',
        });
        gradingResults.push({
          id: stableUuid(21_000_000 + assignmentId, answerId),
          job_id: jobId,
          assignment_id: String(assignmentId),
          student_id: String(studentId),
          question_id: String(questionId),
          score,
          max_score: 50,
          qualitative_grade: score >= 45 ? 'Sangat Baik' : score >= 40 ? 'Baik' : 'Cukup',
          feedback: 'Penilaian demonstrasi sintetis berdasarkan rubrik contoh.',
          citations: [{ source: 'material-sintetis', page: questionNumber }],
          confidence: 'demo',
          rubric_alignment: { synthetic: true, concept: score / 50 },
          language_detected: 'id',
        });
        answerId += 1;
      }
      submissionId += 1;
    }
  }

  const announcements = [
    { id: 1, author_id: 1, title: 'Selamat Datang di Mode Prototype', content: 'Seluruh identitas, jawaban, nilai, dan evidence pada situs ini merupakan data sintetis.', target_type: 'all', target_id: null, start_date: BASE_TIME, end_date: YEAR_END },
    { id: 2, author_id: 2, title: 'Panduan Melihat Hasil', content: 'Buka tugas contoh untuk meninjau hasil automated grading dan plagiarism detection yang telah disiapkan.', target_type: 'all', target_id: null, start_date: BASE_TIME, end_date: YEAR_END },
    { id: 3, author_id: 1, title: 'Reset Harian', content: 'Perubahan data demonstrasi akan dikembalikan ke kondisi awal setiap hari.', target_type: 'all', target_id: null, start_date: BASE_TIME, end_date: YEAR_END },
  ];
  const materials = sessions.map((session) => ({
    id: session.id,
    session_id: session.id,
    title: `Ringkasan Materi ${session.id}`,
    content: 'Materi sintetis tersedia sebagai asset statis prototype dan tidak berasal dari siswa atau layanan eksternal.',
    material_order: 1,
  }));
  const resources = sessions.map((session) => ({
    id: session.id,
    session_id: session.id,
    uploader_id: ((Math.ceil(Number(session.class_course_id) / 2) - 1) % 3) + 2,
    file_url: '/prototype-assets/material-contoh.txt',
    file_name: 'material-contoh.txt',
    file_size: 512,
    file_type: 'text/plain',
    content_type: 'text/plain',
    is_public: true,
    checksum: `synthetic-material-${String(session.id).padStart(2, '0')}`,
    file_tittle: `Materi Sintetis ${session.id}`,
  }));
  const forums = sessions.map((session) => ({
    id: session.id,
    session_id: session.id,
    title: `Forum Refleksi Sesi ${session.id}`,
    creator_id: ((Math.ceil(Number(session.class_course_id) / 2) - 1) % 3) + 2,
    description: 'Forum sintetis untuk mencoba diskusi tanpa data pengguna asli.',
  }));
  const forumPosts = forums.map((forum) => ({
    id: forum.id,
    forum_id: forum.id,
    user_id: Number(forum.id) % 2 === 1 ? 5 : 14,
    title: 'Pertanyaan refleksi sintetis',
    content: 'Bagaimana konsep pada sesi ini dapat diterapkan secara bertanggung jawab?',
    content_type: 'plaintext',
    is_deleted: false,
  }));
  const forumReplies = forumPosts.map((post) => ({
    id: post.id,
    post_id: post.id,
    user_id: Number(post.user_id) + 1,
    parent_reply_id: null,
    content: 'Contoh jawaban sintetis: penerapan perlu mempertimbangkan bukti, konteks, dan dampaknya bagi sesama.',
    content_type: 'plaintext',
    is_deleted: false,
  }));

  const detections: SeedRow[] = [];
  const comparisons: SeedRow[] = [];
  const flags: SeedRow[] = [];
  const risks = [
    { risk: 'HIGH', combined: 0.91, semantic: 0.93, lexical: 0.88 },
    { risk: 'MEDIUM', combined: 0.68, semantic: 0.71, lexical: 0.63 },
    { risk: 'LOW', combined: 0.48, semantic: 0.52, lexical: 0.43 },
    { risk: 'NONE', combined: 0.08, semantic: 0.11, lexical: 0.03 },
  ];
  for (const assignment of assignments) {
    const assignmentId = Number(assignment.id);
    const firstSubmissionId = (assignmentId - 1) * 9 + 1;
    detections.push({
      id: stableUuid(30_000_000, assignmentId),
      assignment_id: String(assignmentId),
      status: 'completed',
      completed_at: addDays(BASE_TIME, 61 + assignmentId),
      total_submissions: 9,
      processed_submissions: 9,
      created_by: String(Math.ceil(assignmentId / 2) + 1),
      scanned_question_ids: ['all'],
    });
    risks.forEach((risk, riskIndex) => {
      const comparisonId = stableUuid(40_000_000 + assignmentId, riskIndex + 1);
      const sourceSubmissionId = firstSubmissionId + riskIndex * 2;
      const targetSubmissionId = sourceSubmissionId + 1;
      const matchedChunks = {
        synthetic: true,
        chunks: risk.risk === 'NONE' ? [] : [{
          question_index: 0,
          source_text: 'Cuplikan sintetis sumber untuk demonstrasi.',
          target_text: 'Cuplikan sintetis pembanding untuk demonstrasi.',
          similarity: risk.combined,
        }],
        per_question_scores: [{
          question_index: 0,
          semantic_score: risk.semantic,
          lexical_score: risk.lexical,
          combined_score: risk.combined,
        }],
      };
      comparisons.push({
        id: comparisonId,
        source_submission_id: String(sourceSubmissionId),
        target_submission_id: String(targetSubmissionId),
        semantic_score: risk.semantic,
        lexical_score: risk.lexical,
        combined_score: risk.combined,
        risk_level: risk.risk,
        matched_chunks: matchedChunks,
        compared_at: addDays(BASE_TIME, 61 + assignmentId),
      });
      if (risk.risk !== 'NONE') {
        flags.push({
          id: stableUuid(50_000_000 + assignmentId, riskIndex + 1),
          comparison_id: comparisonId,
          submission_id: String(sourceSubmissionId),
          status: risk.risk === 'HIGH' ? 'pending' : 'reviewed',
          reviewed: risk.risk !== 'HIGH',
          reviewed_by: risk.risk !== 'HIGH' ? String(Math.ceil(assignmentId / 2) + 1) : null,
          is_false_positive: false,
          teacher_notes: 'Evidence sintetis untuk demonstrasi alur tinjauan guru.',
          action_taken: risk.risk === 'HIGH' ? null : 'reviewed_no_penalty',
        });
      }
    });
  }

  return {
    enumerations,
    users,
    userRoles,
    adminDetails,
    teacherDetails,
    studentDetails,
    profiles,
    academicYears,
    classes,
    courses,
    classCourses,
    enrollments,
    sessions,
    assignments,
    questions,
    submissions,
    answers,
    announcements,
    materials,
    resources,
    forums,
    forumPosts,
    forumReplies,
    acsAssignments,
    gradingJobs,
    gradingResults,
    detections,
    comparisons,
    flags,
  };
}
