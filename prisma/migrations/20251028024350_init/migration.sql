-- CreateTable
CREATE TABLE "admin_details" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kode_admin" VARCHAR(100) NOT NULL,
    "nip" VARCHAR(100),
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "updated_date" TIMESTAMP(3),
    "updated_by" INTEGER,

    CONSTRAINT "admin_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(100) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "user_name" VARCHAR(50) NOT NULL,
    "nama_lengkap" VARCHAR(255) NOT NULL,
    "tanggal_lahir" TIMESTAMP(3),
    "last_login" TIMESTAMP(3),
    "profile_picture_url" VARCHAR(255),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "deleted_by" INTEGER,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "updated_date" TIMESTAMP(3),
    "updated_by" INTEGER,

    CONSTRAINT "app_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user_role" (
    "id" SERIAL NOT NULL,
    "role_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "updated_date" TIMESTAMP(3),
    "updated_by" INTEGER,

    CONSTRAINT "app_user_role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enumeration" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "alt_name" VARCHAR(100),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "category" VARCHAR(100) NOT NULL,
    "created_by" INTEGER,

    CONSTRAINT "enumeration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_details" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "nis" VARCHAR(100) NOT NULL,
    "nisn" VARCHAR(100),
    "parent_contact" VARCHAR(100),
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "updated_date" TIMESTAMP(3),
    "updated_by" INTEGER,

    CONSTRAINT "student_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teacher_details" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "kode_guru" VARCHAR(100) NOT NULL,
    "niy" VARCHAR(100),
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "updated_date" TIMESTAMP(3),
    "updated_by" INTEGER,

    CONSTRAINT "teacher_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profile" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "tmp_lahir" VARCHAR(100),
    "tgl_lahir" TIMESTAMP(3),
    "gender" VARCHAR(10),
    "telepon" VARCHAR(20),
    "alamat" VARCHAR(200),
    "agama" VARCHAR(30),
    "created_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" INTEGER,
    "updated_date" TIMESTAMP(3),
    "updated_by" INTEGER,

    CONSTRAINT "user_profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "academic_years" (
    "id" SERIAL NOT NULL,
    "year_name" VARCHAR(100) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_active" BOOLEAN DEFAULT false,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "academic_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" SERIAL NOT NULL,
    "author_id" INTEGER,
    "title" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "target_type" VARCHAR(20) NOT NULL,
    "target_id" INTEGER,
    "start_date" TIMESTAMP(3) NOT NULL,
    "end_date" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER,
    "student_id" INTEGER,
    "status" VARCHAR(20) NOT NULL,
    "recorded_by" INTEGER,
    "notes" TEXT,
    "recorded_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "class_courses" (
    "id" SERIAL NOT NULL,
    "class_id" INTEGER,
    "course_id" INTEGER,
    "teacher_id" INTEGER,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    "syllabus" TEXT,

    CONSTRAINT "class_courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" SERIAL NOT NULL,
    "class_name" VARCHAR(100) NOT NULL,
    "grade_level" VARCHAR(100) NOT NULL,
    "year_id" INTEGER,
    "wali_kelas" INTEGER,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" SERIAL NOT NULL,
    "course_code" VARCHAR(50) NOT NULL,
    "course_name" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "created_by" INTEGER,
    "updated_by" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" SERIAL NOT NULL,
    "class_course_id" INTEGER,
    "student_id" INTEGER,
    "roll_number" INTEGER,
    "enrollment_date" DATE DEFAULT CURRENT_DATE,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_attachments" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER,
    "reply_id" INTEGER,
    "uploader_id" INTEGER,
    "file_url" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "uploaded_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_posts" (
    "id" SERIAL NOT NULL,
    "forum_id" INTEGER,
    "user_id" INTEGER,
    "title" VARCHAR(100) NOT NULL,
    "content" TEXT NOT NULL,
    "content_type" VARCHAR(100) DEFAULT 'plaintext',
    "is_deleted" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forum_replies" (
    "id" SERIAL NOT NULL,
    "post_id" INTEGER,
    "user_id" INTEGER,
    "parent_reply_id" INTEGER,
    "content" TEXT NOT NULL,
    "content_type" VARCHAR(100) DEFAULT 'plaintext',
    "is_deleted" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forum_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forums" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER,
    "title" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "creator_id" INTEGER,
    "description" TEXT,

    CONSTRAINT "forums_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER,
    "title" VARCHAR(100) NOT NULL,
    "content" TEXT,
    "material_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "title" VARCHAR(100) NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN DEFAULT false,
    "notification_type" VARCHAR(50) NOT NULL,
    "related_entity_type" VARCHAR(50),
    "related_entity_id" INTEGER,
    "created_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMP(3),

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resources" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER,
    "uploader_id" INTEGER,
    "file_url" VARCHAR(255) NOT NULL,
    "file_name" VARCHAR(100) NOT NULL,
    "file_size" INTEGER NOT NULL,
    "file_type" VARCHAR(50) NOT NULL,
    "content_type" VARCHAR(100),
    "version" INTEGER DEFAULT 1,
    "is_public" BOOLEAN DEFAULT false,
    "download_count" INTEGER DEFAULT 0,
    "last_downloaded" TIMESTAMP(3),
    "checksum" VARCHAR(64),
    "file_tittle" VARCHAR,

    CONSTRAINT "resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" SERIAL NOT NULL,
    "class_course_id" INTEGER,
    "title" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "session_number" INTEGER NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,
    "end_time" TIMESTAMP(3) NOT NULL,
    "is_completed" BOOLEAN DEFAULT false,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_answers" (
    "id" SERIAL NOT NULL,
    "submission_id" INTEGER NOT NULL,
    "question_id" INTEGER NOT NULL,
    "answer_text" TEXT,
    "selected_option_id" INTEGER,
    "points_earned" DECIMAL(5,2) DEFAULT 0,
    "feedback" TEXT,
    "created_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3),

    CONSTRAINT "assignment_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_question_options" (
    "id" SERIAL NOT NULL,
    "question_id" INTEGER NOT NULL,
    "option_text" TEXT NOT NULL,
    "is_correct" BOOLEAN DEFAULT false,
    "order_number" INTEGER NOT NULL,
    "created_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_question_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_questions" (
    "id" SERIAL NOT NULL,
    "assignment_id" INTEGER NOT NULL,
    "question_type_id" INTEGER NOT NULL,
    "question_text" TEXT NOT NULL,
    "points" INTEGER DEFAULT 1,
    "order_number" INTEGER NOT NULL,
    "required" BOOLEAN DEFAULT true,
    "created_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3),

    CONSTRAINT "assignment_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_submissions" (
    "id" SERIAL NOT NULL,
    "assignment_id" INTEGER NOT NULL,
    "student_id" INTEGER NOT NULL,
    "attempt_number" INTEGER DEFAULT 1,
    "started_at" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "status_id" INTEGER NOT NULL,
    "total_score" DECIMAL(5,2),
    "feedback" TEXT,
    "graded_by" INTEGER,
    "graded_at" TIMESTAMP(3),
    "created_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3),

    CONSTRAINT "assignment_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignments" (
    "id" SERIAL NOT NULL,
    "session_id" INTEGER NOT NULL,
    "assignment_type_id" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "total_points" INTEGER DEFAULT 100,
    "due_date" TIMESTAMP(3),
    "start_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "time_limit" INTEGER,
    "attempts_allowed" INTEGER DEFAULT 1,
    "show_results" BOOLEAN DEFAULT true,
    "is_published" BOOLEAN DEFAULT false,
    "created_by" INTEGER NOT NULL,
    "created_date" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updated_date" TIMESTAMP(3),
    "updated_by" INTEGER,

    CONSTRAINT "assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_details_user_id_key" ON "admin_details"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_details_kode_admin_key" ON "admin_details"("kode_admin");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_email_key" ON "app_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_user_name_key" ON "app_user"("user_name");

-- CreateIndex
CREATE UNIQUE INDEX "enumeration_name_category_key" ON "enumeration"("name", "category");

-- CreateIndex
CREATE UNIQUE INDEX "student_details_user_id_key" ON "student_details"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_details_nis_key" ON "student_details"("nis");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_details_user_id_key" ON "teacher_details"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "teacher_details_kode_guru_key" ON "teacher_details"("kode_guru");

-- CreateIndex
CREATE UNIQUE INDEX "user_profile_user_id_key" ON "user_profile"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "academic_years_year_name_key" ON "academic_years"("year_name");

-- CreateIndex
CREATE INDEX "idx_academic_years_active" ON "academic_years"("is_active");

-- CreateIndex
CREATE INDEX "idx_academic_years_dates" ON "academic_years"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "idx_announcements_active" ON "announcements"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "idx_announcements_author" ON "announcements"("author_id");

-- CreateIndex
CREATE INDEX "idx_announcements_dates" ON "announcements"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "idx_announcements_target" ON "announcements"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "idx_attendance_date" ON "attendance"("recorded_at");

-- CreateIndex
CREATE INDEX "idx_attendance_reporting" ON "attendance"("session_id", "status", "recorded_at");

-- CreateIndex
CREATE INDEX "idx_attendance_session" ON "attendance"("session_id");

-- CreateIndex
CREATE INDEX "idx_attendance_status" ON "attendance"("status");

-- CreateIndex
CREATE INDEX "idx_attendance_student" ON "attendance"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_session_id_student_id_key" ON "attendance"("session_id", "student_id");

-- CreateIndex
CREATE INDEX "idx_class_courses_active" ON "class_courses"("is_active");

-- CreateIndex
CREATE INDEX "idx_class_courses_class" ON "class_courses"("class_id");

-- CreateIndex
CREATE INDEX "idx_class_courses_course" ON "class_courses"("course_id");

-- CreateIndex
CREATE INDEX "idx_class_courses_dates" ON "class_courses"("start_date", "end_date");

-- CreateIndex
CREATE INDEX "idx_class_courses_teacher" ON "class_courses"("teacher_id");

-- CreateIndex
CREATE UNIQUE INDEX "class_courses_class_id_course_id_key" ON "class_courses"("class_id", "course_id");

-- CreateIndex
CREATE INDEX "idx_classes_grade" ON "classes"("grade_level", "year_id");

-- CreateIndex
CREATE INDEX "idx_classes_wali_kelas" ON "classes"("wali_kelas");

-- CreateIndex
CREATE INDEX "idx_classes_year" ON "classes"("year_id");

-- CreateIndex
CREATE UNIQUE INDEX "classes_class_name_year_id_key" ON "classes"("class_name", "year_id");

-- CreateIndex
CREATE UNIQUE INDEX "courses_course_code_key" ON "courses"("course_code");

-- CreateIndex
CREATE INDEX "idx_courses_name" ON "courses"("course_name");

-- CreateIndex
CREATE INDEX "idx_enrollments_class_course" ON "enrollments"("class_course_id");

-- CreateIndex
CREATE INDEX "idx_enrollments_date" ON "enrollments"("enrollment_date");

-- CreateIndex
CREATE INDEX "idx_enrollments_student" ON "enrollments"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "enrollments_class_course_id_student_id_key" ON "enrollments"("class_course_id", "student_id");

-- CreateIndex
CREATE INDEX "idx_forum_attachments_uploader" ON "forum_attachments"("uploader_id");

-- CreateIndex
CREATE INDEX "idx_forum_posts_created" ON "forum_posts"("created_at");

-- CreateIndex
CREATE INDEX "idx_forum_posts_deleted" ON "forum_posts"("is_deleted");

-- CreateIndex
CREATE INDEX "idx_forum_posts_forum" ON "forum_posts"("forum_id");

-- CreateIndex
CREATE INDEX "idx_forum_posts_user" ON "forum_posts"("user_id");

-- CreateIndex
CREATE INDEX "idx_forum_replies_created" ON "forum_replies"("created_at");

-- CreateIndex
CREATE INDEX "idx_forum_replies_deleted" ON "forum_replies"("is_deleted");

-- CreateIndex
CREATE INDEX "idx_forum_replies_parent" ON "forum_replies"("parent_reply_id");

-- CreateIndex
CREATE INDEX "idx_forum_replies_post" ON "forum_replies"("post_id");

-- CreateIndex
CREATE INDEX "idx_forum_replies_user" ON "forum_replies"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "forums_session_id_key" ON "forums"("session_id");

-- CreateIndex
CREATE INDEX "forums_id_idx" ON "forums"("id", "session_id", "creator_id", "title", "created_at");

-- CreateIndex
CREATE INDEX "idx_forums_creator" ON "forums"("creator_id");

-- CreateIndex
CREATE INDEX "idx_forums_session" ON "forums"("session_id");

-- CreateIndex
CREATE INDEX "idx_materials_order" ON "materials"("material_order");

-- CreateIndex
CREATE INDEX "idx_materials_session" ON "materials"("session_id");

-- CreateIndex
CREATE INDEX "idx_notifications_created" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "idx_notifications_entity" ON "notifications"("related_entity_type", "related_entity_id");

-- CreateIndex
CREATE INDEX "idx_notifications_type" ON "notifications"("notification_type");

-- CreateIndex
CREATE INDEX "idx_notifications_user" ON "notifications"("user_id");

-- CreateIndex
CREATE INDEX "idx_resources_file_type" ON "resources"("file_type");

-- CreateIndex
CREATE INDEX "idx_resources_session" ON "resources"("session_id");

-- CreateIndex
CREATE INDEX "idx_resources_uploader" ON "resources"("uploader_id");

-- CreateIndex
CREATE INDEX "idx_sessions_class_course" ON "sessions"("class_course_id");

-- CreateIndex
CREATE INDEX "idx_sessions_completed" ON "sessions"("is_completed");

-- CreateIndex
CREATE INDEX "idx_sessions_number" ON "sessions"("session_number");

-- CreateIndex
CREATE INDEX "idx_sessions_time" ON "sessions"("start_time", "end_time");

-- CreateIndex
CREATE INDEX "idx_assignment_answers_option" ON "assignment_answers"("selected_option_id");

-- CreateIndex
CREATE INDEX "idx_assignment_answers_question" ON "assignment_answers"("question_id");

-- CreateIndex
CREATE INDEX "idx_assignment_answers_submission" ON "assignment_answers"("submission_id");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_answers_submission_id_question_id_key" ON "assignment_answers"("submission_id", "question_id");

-- CreateIndex
CREATE INDEX "idx_assignment_question_options_correct" ON "assignment_question_options"("is_correct");

-- CreateIndex
CREATE INDEX "idx_assignment_question_options_question" ON "assignment_question_options"("question_id");

-- CreateIndex
CREATE INDEX "idx_assignment_questions_assignment" ON "assignment_questions"("assignment_id", "order_number");

-- CreateIndex
CREATE INDEX "idx_assignment_questions_type" ON "assignment_questions"("question_type_id");

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_assignment" ON "assignment_submissions"("assignment_id");

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_graded_by" ON "assignment_submissions"("graded_by");

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_status" ON "assignment_submissions"("status_id");

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_student" ON "assignment_submissions"("student_id");

-- CreateIndex
CREATE INDEX "idx_assignment_submissions_submitted" ON "assignment_submissions"("submitted_at");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_submissions_assignment_id_student_id_attempt_num_key" ON "assignment_submissions"("assignment_id", "student_id", "attempt_number");

-- CreateIndex
CREATE INDEX "idx_assignments_created_by" ON "assignments"("created_by");

-- CreateIndex
CREATE INDEX "idx_assignments_due_date" ON "assignments"("due_date");

-- CreateIndex
CREATE INDEX "idx_assignments_published" ON "assignments"("is_published");

-- CreateIndex
CREATE INDEX "idx_assignments_session" ON "assignments"("session_id");

-- CreateIndex
CREATE INDEX "idx_assignments_type" ON "assignments"("assignment_type_id");

-- AddForeignKey
ALTER TABLE "admin_details" ADD CONSTRAINT "admin_details_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user_role" ADD CONSTRAINT "app_user_role_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "enumeration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_user_role" ADD CONSTRAINT "app_user_role_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_details" ADD CONSTRAINT "student_details_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teacher_details" ADD CONSTRAINT "teacher_details_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_profile" ADD CONSTRAINT "user_profile_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_courses" ADD CONSTRAINT "class_courses_class_id_fkey" FOREIGN KEY ("class_id") REFERENCES "classes"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_courses" ADD CONSTRAINT "class_courses_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "class_courses" ADD CONSTRAINT "class_courses_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_wali_kelas_fkey" FOREIGN KEY ("wali_kelas") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_year_id_fkey" FOREIGN KEY ("year_id") REFERENCES "academic_years"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_class_course_id_fkey" FOREIGN KEY ("class_course_id") REFERENCES "class_courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forum_attachments" ADD CONSTRAINT "forum_attachments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forum_attachments" ADD CONSTRAINT "forum_attachments_reply_id_fkey" FOREIGN KEY ("reply_id") REFERENCES "forum_replies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forum_attachments" ADD CONSTRAINT "forum_attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_forum_id_fkey" FOREIGN KEY ("forum_id") REFERENCES "forums"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_parent_reply_id_fkey" FOREIGN KEY ("parent_reply_id") REFERENCES "forum_replies"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "forum_posts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forum_replies" ADD CONSTRAINT "forum_replies_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forums" ADD CONSTRAINT "forums_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "forums" ADD CONSTRAINT "forums_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "resources" ADD CONSTRAINT "resources_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "app_user"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_class_course_id_fkey" FOREIGN KEY ("class_course_id") REFERENCES "class_courses"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_answers" ADD CONSTRAINT "assignment_answers_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "assignment_questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_answers" ADD CONSTRAINT "assignment_answers_selected_option_id_fkey" FOREIGN KEY ("selected_option_id") REFERENCES "assignment_question_options"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_answers" ADD CONSTRAINT "assignment_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "assignment_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_question_options" ADD CONSTRAINT "assignment_question_options_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "assignment_questions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_questions" ADD CONSTRAINT "assignment_questions_question_type_id_fkey" FOREIGN KEY ("question_type_id") REFERENCES "enumeration"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_graded_by_fkey" FOREIGN KEY ("graded_by") REFERENCES "app_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "enumeration"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignment_submissions" ADD CONSTRAINT "assignment_submissions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "app_user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_assignment_type_id_fkey" FOREIGN KEY ("assignment_type_id") REFERENCES "enumeration"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "app_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "app_user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
