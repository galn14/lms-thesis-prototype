# LMS Thesis Prototype

LMS Thesis Prototype is a web-based Learning Management System that combines academic learning management with two primary research features: **Automated Grading** and **Plagiarism Detection**. The program extends the LMS of SMA Katolik St. Louis 2 Surabaya to demonstrate essay assessment and answer-similarity analysis within a single system.

## About the Program

The application supports learning activities for administrators, teachers, and students. Each role receives an appropriate interface and level of access for managing academic data, participating in classes, completing assignments, and reviewing assessment results.

The prototype presents a complete academic scenario using synthetic data. Prepared Automated Grading and Plagiarism Detection records allow readers to explore scores, feedback, risk levels, and supporting evidence directly through the LMS interface.

## Main Functions

### Academic Management

- Manages academic years, users, roles, classes, subjects, and student enrollments.
- Connects teachers and students with the appropriate classes and subjects.
- Organizes learning sessions, syllabi, schedules, and announcements.

### Learning Materials and Class Interaction

- Presents learning materials and resources for each session.
- Provides discussion forums with posts and replies.
- Controls access to class content according to user roles.

### Assignments and Assessment

- Organizes assignments and essay questions for learning sessions.
- Records submissions, student answers, scores, and feedback.
- Presents grade summaries from teacher and student perspectives.

### Automated Grading

Automated Grading presents essay-evaluation results for each student and question. The displayed information includes the awarded score, maximum score, result category, feedback, confidence level, rubric alignment, answer language, and material references.

### Plagiarism Detection

Plagiarism Detection compares submissions through semantic and lexical similarity. Results are grouped into **high**, **medium**, **low**, and **clean** risk levels. Each result includes the submission pair, comparison scores, related answer sections, and evidence that supports teacher review.

### System Administration

- Presents dashboards and summaries of LMS activity.
- Manages users, classes, subjects, and feature-access controls.
- Records administrative activity through audit logs.

## User Roles

- **Administrators** manage academic structures, accounts, configuration, and feature access.
- **Teachers** manage classes, sessions, materials, forums, assignments, assessment, and result review.
- **Students** participate in classes, read materials, join discussions, submit assignments, and view results.

## Demonstration Scenario

The prototype dataset represents the 2026/2027 academic year with:

- 1 administrator, 3 teachers, and 18 active students;
- 2 classes and 3 subjects: Geography, Biology, and Religion;
- 12 learning sessions and 6 assignments;
- 12 essay questions, 54 submissions, and 108 answers with grading results;
- plagiarism-detection results covering every risk level;
- connected materials, announcements, forums, posts, and replies.

The data can change during a demonstration and is periodically returned to its initial state. A banner in the application indicates that the system is running in Prototype Mode.

## Core Technologies

- Next.js and TypeScript for the web application;
- Tailwind CSS for the user interface;
- NextAuth for authentication;
- Prisma for the main LMS schema;
- PostgreSQL and pgvector for academic data and similarity results;
- Neon for the database service and Vercel for the prototype application platform.

## Attribution

This prototype extends the LMS of SMA Katolik St. Louis 2 Surabaya from the `Josedio30/LMS_StLouis2` repository. Galeno Areliano developed the research features and demonstration environment.

Further attribution information is available in [NOTICE.md](NOTICE.md).
