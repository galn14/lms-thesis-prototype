import { hash } from 'bcryptjs';
import { Client } from 'pg';

import { buildSyntheticDataset, SeedRow } from '@/lib/prototype/synthetic-dataset';
import { assertSameDatabaseTarget } from '@/lib/prototype/database-identity';

export const PROTOTYPE_SCHEMA_VERSION = 1;
const RESET_LOCK_KEY = 1_842_026_027;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface QueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number | null;
}

export interface PrototypeDatabaseClient {
  connect(): Promise<void>;
  query(sql: string, parameters?: readonly unknown[]): Promise<QueryResult>;
  end(): Promise<void>;
}

interface ResetEnvironment {
  PROTOTYPE_MODE?: string;
  PROTOTYPE_INSTALLATION_ID?: string;
  DEMO_SHARED_PASSWORD?: string;
  AUX_POSTGRES_URL?: string;
  DATABASE_URL?: string;
  DATABASE_URL_UNPOOLED?: string;
}

interface ResetOptions {
  client?: PrototypeDatabaseClient;
  environment?: ResetEnvironment;
}

export interface PrototypeResetResult {
  resetVersion: number;
  completedAt: string;
}

export class PrototypeResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrototypeResetError';
  }
}

export class ResetInProgressError extends PrototypeResetError {
  constructor() {
    super('A prototype reset is already in progress');
    this.name = 'ResetInProgressError';
  }
}

function requiredEnvironment(environment: ResetEnvironment) {
  if (environment.PROTOTYPE_MODE !== 'true') {
    throw new PrototypeResetError('PROTOTYPE_MODE must be exactly "true" before reset');
  }
  const installationId = environment.PROTOTYPE_INSTALLATION_ID?.trim();
  if (!installationId || !UUID_PATTERN.test(installationId)) {
    throw new PrototypeResetError('PROTOTYPE_INSTALLATION_ID must be a valid UUID');
  }
  const password = environment.DEMO_SHARED_PASSWORD;
  if (!password) {
    throw new PrototypeResetError('DEMO_SHARED_PASSWORD must be set before reset');
  }
  const connectionString = environment.AUX_POSTGRES_URL ?? environment.DATABASE_URL;
  if (!connectionString) {
    throw new PrototypeResetError('AUX_POSTGRES_URL or DATABASE_URL must be set before reset');
  }
  if (
    environment.AUX_POSTGRES_URL &&
    environment.DATABASE_URL &&
    environment.AUX_POSTGRES_URL.trim() !== environment.DATABASE_URL.trim()
  ) {
    throw new PrototypeResetError('AUX_POSTGRES_URL and DATABASE_URL must use the same pooled database URL');
  }
  const directConnectionString = environment.DATABASE_URL_UNPOOLED;
  if (!directConnectionString) {
    throw new PrototypeResetError('DATABASE_URL_UNPOOLED must be set before reset');
  }
  try {
    assertSameDatabaseTarget(
      connectionString,
      directConnectionString,
      'DATABASE_URL',
      'DATABASE_URL_UNPOOLED'
    );
  } catch (error) {
    throw new PrototypeResetError(error instanceof Error ? error.message : 'Invalid database target');
  }
  return { installationId, password, connectionString };
}

function createPgClient(connectionString: string): PrototypeDatabaseClient {
  const client = new Client({
    connectionString,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
  });
  return {
    connect: () => client.connect(),
    query: async (sql, parameters = []) => {
      const result = await client.query(sql, [...parameters]);
      return {
        rows: result.rows as Array<Record<string, unknown>>,
        rowCount: result.rowCount,
      };
    },
    end: () => client.end(),
  };
}

function placeholders(rowCount: number, columnCount: number): string {
  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = Array.from(
      { length: columnCount },
      (_, columnIndex) => `$${rowIndex * columnCount + columnIndex + 1}`
    );
    return `(${row.join(', ')})`;
  }).join(', ');
}

async function insertRows(
  client: PrototypeDatabaseClient,
  table: string,
  columns: readonly string[],
  rows: readonly SeedRow[]
): Promise<void> {
  const values = rows.flatMap((row) => columns.map((column) => row[column] ?? null));
  await client.query(
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${placeholders(rows.length, columns.length)}`,
    values
  );
}

async function clearPrototypeData(client: PrototypeDatabaseClient): Promise<void> {
  await client.query(`
    TRUNCATE TABLE
      forum_attachments,
      forum_replies,
      forum_posts,
      forums,
      notifications,
      attendance,
      resources,
      materials,
      assignment_question_options,
      assignment_answers,
      assignment_submissions,
      assignment_questions,
      assignments,
      sessions,
      enrollments,
      class_courses,
      classes,
      courses,
      announcements,
      academic_years,
      user_profile,
      student_details,
      teacher_details,
      admin_details,
      app_user_role,
      app_user,
      enumeration,
      acs_token_usage,
      acs_grading_results,
      acs_grading_jobs,
      acs_uploaded_files,
      acs_assignments,
      pds_teacher_actions,
      pds_flags,
      pds_comparisons,
      pds_embeddings,
      pds_chunks,
      pds_detections,
      pds_audit_logs,
      feature_access,
      api_credential,
      ai_config,
      audit_log
    RESTART IDENTITY CASCADE
  `);
}

async function insertSyntheticData(
  client: PrototypeDatabaseClient,
  passwordHash: string
): Promise<void> {
  const data = buildSyntheticDataset(passwordHash);
  await insertRows(client, 'enumeration', ['id', 'name', 'alt_name', 'category', 'is_default'], data.enumerations);
  await insertRows(client, 'app_user', ['id', 'email', 'password', 'user_name', 'nama_lengkap'], data.users);
  await insertRows(client, 'app_user_role', ['id', 'role_id', 'user_id'], data.userRoles);
  await insertRows(client, 'admin_details', ['id', 'user_id', 'kode_admin'], data.adminDetails);
  await insertRows(client, 'teacher_details', ['id', 'user_id', 'kode_guru', 'niy'], data.teacherDetails);
  await insertRows(client, 'student_details', ['id', 'user_id', 'nis', 'nisn'], data.studentDetails);
  await insertRows(client, 'user_profile', ['id', 'user_id', 'tmp_lahir', 'agama'], data.profiles);
  await insertRows(client, 'academic_years', ['id', 'year_name', 'start_date', 'end_date', 'is_active'], data.academicYears);
  await insertRows(client, 'classes', ['id', 'class_name', 'grade_level', 'year_id', 'wali_kelas'], data.classes);
  await insertRows(client, 'courses', ['id', 'course_code', 'course_name', 'description'], data.courses);
  await insertRows(client, 'class_courses', ['id', 'class_id', 'course_id', 'teacher_id', 'start_date', 'end_date', 'is_active', 'syllabus'], data.classCourses);
  await insertRows(client, 'enrollments', ['id', 'class_course_id', 'student_id', 'roll_number', 'enrollment_date'], data.enrollments);
  await insertRows(client, 'sessions', ['id', 'class_course_id', 'title', 'description', 'session_number', 'start_time', 'end_time', 'is_completed'], data.sessions);
  await insertRows(client, 'assignments', ['id', 'session_id', 'assignment_type_id', 'title', 'description', 'instructions', 'total_points', 'due_date', 'start_date', 'attempts_allowed', 'show_results', 'is_published', 'created_by'], data.assignments);
  await insertRows(client, 'assignment_questions', ['id', 'assignment_id', 'question_type_id', 'question_text', 'points', 'order_number', 'required'], data.questions);
  await insertRows(client, 'assignment_submissions', ['id', 'assignment_id', 'student_id', 'attempt_number', 'submitted_at', 'status_id', 'total_score', 'feedback', 'graded_by', 'graded_at'], data.submissions);
  await insertRows(client, 'assignment_answers', ['id', 'submission_id', 'question_id', 'answer_text', 'points_earned', 'feedback'], data.answers);
  await insertRows(client, 'announcements', ['id', 'author_id', 'title', 'content', 'target_type', 'target_id', 'start_date', 'end_date'], data.announcements);
  await insertRows(client, 'materials', ['id', 'session_id', 'title', 'content', 'material_order'], data.materials);
  await insertRows(client, 'resources', ['id', 'session_id', 'uploader_id', 'file_url', 'file_name', 'file_size', 'file_type', 'content_type', 'is_public', 'checksum', 'file_tittle'], data.resources);
  await insertRows(client, 'forums', ['id', 'session_id', 'title', 'creator_id', 'description'], data.forums);
  await insertRows(client, 'forum_posts', ['id', 'forum_id', 'user_id', 'title', 'content', 'content_type', 'is_deleted'], data.forumPosts);
  await insertRows(client, 'forum_replies', ['id', 'post_id', 'user_id', 'parent_reply_id', 'content', 'content_type', 'is_deleted'], data.forumReplies);
  await insertRows(client, 'acs_assignments', ['id', 'assignment_id', 'course_id', 'vector_store_id', 'rubric', 'created_by', 'status', 'rerun_grading'], data.acsAssignments);
  await insertRows(client, 'acs_grading_jobs', ['id', 'assignment_id', 'total_students', 'status', 'completed_at'], data.gradingJobs);
  await insertRows(client, 'acs_grading_results', ['id', 'job_id', 'assignment_id', 'student_id', 'question_id', 'score', 'max_score', 'qualitative_grade', 'feedback', 'citations', 'confidence', 'rubric_alignment', 'language_detected'], data.gradingResults);
  await insertRows(client, 'pds_detections', ['id', 'assignment_id', 'status', 'completed_at', 'total_submissions', 'processed_submissions', 'created_by', 'scanned_question_ids'], data.detections);
  await insertRows(client, 'pds_comparisons', ['id', 'source_submission_id', 'target_submission_id', 'semantic_score', 'lexical_score', 'combined_score', 'risk_level', 'matched_chunks', 'compared_at'], data.comparisons);
  await insertRows(client, 'pds_flags', ['id', 'comparison_id', 'submission_id', 'status', 'reviewed', 'reviewed_by', 'is_false_positive', 'teacher_notes', 'action_taken'], data.flags);

  await client.query(`
    INSERT INTO ai_config (id, model, temperature, system_prompt)
    VALUES (1, 'prototype-disabled', 0, 'External processing is disabled in prototype mode.')
  `);
  await client.query(`
    INSERT INTO feature_access (scope_type, scope_id, feature, enabled, updated_by)
    SELECT 'course', id::text, feature, TRUE, 'prototype-reset'
    FROM courses
    CROSS JOIN (VALUES ('ai_grading'), ('plagiarism')) AS enabled_features(feature)
  `);

  await client.query(`
    DO $$
    DECLARE
      target_table TEXT;
    BEGIN
      FOREACH target_table IN ARRAY ARRAY[
        'enumeration', 'app_user', 'app_user_role', 'admin_details',
        'teacher_details', 'student_details', 'user_profile', 'academic_years',
        'classes', 'courses', 'class_courses', 'enrollments', 'sessions',
        'assignments', 'assignment_questions', 'assignment_submissions',
        'assignment_answers', 'announcements', 'materials', 'resources',
        'forums', 'forum_posts', 'forum_replies'
      ]
      LOOP
        EXECUTE format(
          'SELECT setval(pg_get_serial_sequence(%L, ''id''), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM %I',
          target_table,
          target_table
        );
      END LOOP;
    END $$
  `);
}

function readMetadata(rows: Array<Record<string, unknown>>): {
  installationId: string;
  schemaVersion: number;
} {
  const metadata = rows[0];
  if (!metadata) {
    throw new PrototypeResetError('prototype_metadata safety marker is missing');
  }
  return {
    installationId: String(metadata.installation_id),
    schemaVersion: Number(metadata.schema_version),
  };
}

export async function resetPrototypeDatabase(
  options: ResetOptions = {}
): Promise<PrototypeResetResult> {
  const environment: ResetEnvironment = options.environment ?? {
    PROTOTYPE_MODE: process.env.PROTOTYPE_MODE,
    PROTOTYPE_INSTALLATION_ID: process.env.PROTOTYPE_INSTALLATION_ID,
    DEMO_SHARED_PASSWORD: process.env.DEMO_SHARED_PASSWORD,
    AUX_POSTGRES_URL: process.env.AUX_POSTGRES_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_URL_UNPOOLED: process.env.DATABASE_URL_UNPOOLED,
  };
  const { installationId, password, connectionString } = requiredEnvironment(environment);
  const client = options.client ?? createPgClient(connectionString);
  await client.connect();

  try {
    await client.query('BEGIN');
    const lockResult = await client.query(
      'SELECT pg_try_advisory_xact_lock($1) AS acquired',
      [RESET_LOCK_KEY]
    );
    if (lockResult.rows[0]?.acquired !== true) {
      throw new ResetInProgressError();
    }

    const metadataResult = await client.query(`
      SELECT installation_id::text, schema_version
      FROM prototype_metadata
      WHERE singleton = TRUE
      FOR UPDATE
    `);
    const metadata = readMetadata(metadataResult.rows);
    if (metadata.installationId !== installationId) {
      throw new PrototypeResetError('Database installation marker does not match PROTOTYPE_INSTALLATION_ID');
    }
    if (metadata.schemaVersion !== PROTOTYPE_SCHEMA_VERSION) {
      throw new PrototypeResetError(
        `Database schema version ${metadata.schemaVersion} does not match prototype schema version ${PROTOTYPE_SCHEMA_VERSION}`
      );
    }

    const passwordHash = await hash(password, 12);
    await clearPrototypeData(client);
    await insertSyntheticData(client, passwordHash);
    const updateResult = await client.query(`
      UPDATE prototype_metadata
      SET
        reset_version = reset_version + 1,
        last_reset_at = NOW(),
        updated_at = NOW()
      WHERE singleton = TRUE
      RETURNING reset_version::text, last_reset_at::text AS completed_at
    `);
    const updated = updateResult.rows[0];
    if (!updated) {
      throw new PrototypeResetError('Failed to update prototype reset metadata');
    }
    await client.query('COMMIT');
    return {
      resetVersion: Number(updated.reset_version),
      completedAt: String(updated.completed_at),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}
