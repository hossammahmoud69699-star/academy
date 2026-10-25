-- 001_init.sql — المخطط الأولي لمنصة الأكاديمية (PostgreSQL 14+)
-- يُشغَّل داخل transaction واحدة.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- ============ دوال مساعدة ============
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql;

-- ============ الأدوار والمستخدمون ============
CREATE TABLE roles (
  id          smallint PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code IN ('admin','content_manager','teacher','student')),
  name_ar     text NOT NULL
);

CREATE TABLE academic_grades (
  id          serial PRIMARY KEY,
  name_ar     text NOT NULL UNIQUE,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true
);

CREATE TABLE users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id          smallint NOT NULL REFERENCES roles(id),
  full_name        text NOT NULL,
  phone            text UNIQUE,
  email            citext UNIQUE,
  password_hash    text NOT NULL,                     -- Argon2id
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  grade_id         int REFERENCES academic_grades(id),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
  failed_logins    int NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_contact_chk CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX users_role_idx ON users(role_id);
CREATE INDEX users_grade_idx ON users(grade_id);
CREATE INDEX users_name_idx ON users(lower(full_name));
CREATE TRIGGER users_upd BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ============ الأجهزة والجلسات ============
CREATE TABLE devices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint_hash text NOT NULL,                     -- تجزئة المعرّف، ليس المعرّف نفسه
  model           text,
  os_version      text,
  app_version     text,
  fcm_token       text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  bound_at        timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES users(id),
  last_seen_at    timestamptz
);
-- جهاز نشط واحد فقط لكل طالب افتراضيًا
CREATE UNIQUE INDEX devices_one_active_per_user ON devices(user_id) WHERE status = 'active';
CREATE UNIQUE INDEX devices_user_fp ON devices(user_id, fingerprint_hash);
CREATE INDEX devices_fp_idx ON devices(fingerprint_hash);

CREATE TABLE user_sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id          uuid REFERENCES devices(id) ON DELETE SET NULL,  -- null لجلسات لوحة الويب
  refresh_token_hash text NOT NULL UNIQUE,
  ip                 inet,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text
);
CREATE INDEX sessions_user_active_idx ON user_sessions(user_id) WHERE revoked_at IS NULL;

CREATE TABLE login_attempts (
  id          bigserial PRIMARY KEY,
  identifier  text NOT NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  ip          inet,
  success     boolean NOT NULL,
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX login_attempts_ident_idx ON login_attempts(identifier, created_at DESC);
CREATE INDEX login_attempts_ip_idx ON login_attempts(ip, created_at DESC);

-- ============ المحتوى ============
CREATE TABLE subjects (
  id          serial PRIMARY KEY,
  name_ar     text NOT NULL,
  grade_id    int REFERENCES academic_grades(id),
  is_active   boolean NOT NULL DEFAULT true,
  UNIQUE (name_ar, grade_id)
);

CREATE TABLE courses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id      int NOT NULL REFERENCES subjects(id),
  grade_id        int NOT NULL REFERENCES academic_grades(id),
  teacher_id      uuid NOT NULL REFERENCES users(id),
  title           text NOT NULL,
  description     text,
  cover_object_key text,
  price_cents     int NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  publish_at      timestamptz,
  unpublish_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (unpublish_at IS NULL OR publish_at IS NULL OR unpublish_at > publish_at)
);
CREATE INDEX courses_teacher_idx ON courses(teacher_id);
CREATE INDEX courses_filter_idx ON courses(grade_id, subject_id, status);
CREATE INDEX courses_title_idx ON courses(lower(title));
CREATE TRIGGER courses_upd BEFORE UPDATE ON courses FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE chapters (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id   uuid NOT NULL REFERENCES courses(id),
  title       text NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX chapters_course_idx ON chapters(course_id, sort_order);

CREATE TABLE video_assets (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  object_key       text NOT NULL UNIQUE,              -- مسار داخل التخزين الخاص (HLS manifest)
  source_key       text,
  duration_seconds int CHECK (duration_seconds IS NULL OR duration_seconds > 0),
  size_bytes       bigint,
  mime_type        text,
  encryption_key_id text,                             -- مرجع المفتاح، لا المفتاح نفسه
  processing_status text NOT NULL DEFAULT 'uploaded' CHECK (processing_status IN ('uploaded','processing','ready','failed')),
  uploaded_by      uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lectures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chapter_id       uuid NOT NULL REFERENCES chapters(id),
  title            text NOT NULL,
  description      text,
  video_asset_id   uuid REFERENCES video_assets(id),
  pdf_object_key   text,
  duration_seconds int CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  sort_order       int NOT NULL DEFAULT 0,
  is_free_preview  boolean NOT NULL DEFAULT false,
  allow_download   boolean NOT NULL DEFAULT false,
  prerequisite_lecture_id uuid REFERENCES lectures(id),
  min_watch_percent_for_next smallint CHECK (min_watch_percent_for_next BETWEEN 0 AND 100),
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  publish_at       timestamptz,
  unpublish_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (prerequisite_lecture_id IS NULL OR prerequisite_lecture_id <> id)
);
CREATE INDEX lectures_chapter_idx ON lectures(chapter_id, sort_order);
CREATE TRIGGER lectures_upd BEFORE UPDATE ON lectures FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE course_enrollments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  course_id   uuid NOT NULL REFERENCES courses(id),
  source      text NOT NULL CHECK (source IN ('code','payment','admin','free')),
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, course_id)
);
CREATE INDEX enrollments_course_idx ON course_enrollments(course_id);

-- ============ الأكواد والاشتراكات والمدفوعات ============
CREATE TABLE code_batches (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE activation_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id      uuid REFERENCES code_batches(id),
  code_hash     text NOT NULL UNIQUE,                 -- HMAC للكود
  code_hint     text,                                 -- آخر 4 رموز للعرض
  target_type   text NOT NULL CHECK (target_type IN ('course','chapter','lecture')),
  course_id     uuid REFERENCES courses(id),
  chapter_id    uuid REFERENCES chapters(id),
  lecture_id    uuid REFERENCES lectures(id),
  price_cents   int NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_until   timestamptz,
  access_days   int CHECK (access_days IS NULL OR access_days > 0),  -- مدة الاشتراك بعد التفعيل
  max_uses      int NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count     int NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  status        text NOT NULL DEFAULT 'available' CHECK (status IN ('available','used','expired','revoked')),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (use_count <= max_uses),
  CHECK (valid_until IS NULL OR valid_until > valid_from),
  CHECK (
    (target_type = 'course'  AND course_id  IS NOT NULL AND chapter_id IS NULL AND lecture_id IS NULL) OR
    (target_type = 'chapter' AND chapter_id IS NOT NULL AND course_id  IS NULL AND lecture_id IS NULL) OR
    (target_type = 'lecture' AND lecture_id IS NOT NULL AND course_id  IS NULL AND chapter_id IS NULL)
  )
);
CREATE INDEX codes_batch_idx ON activation_codes(batch_id);
CREATE INDEX codes_status_idx ON activation_codes(status);

CREATE TABLE subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  target_type text NOT NULL CHECK (target_type IN ('course','chapter','lecture')),
  course_id   uuid REFERENCES courses(id),
  chapter_id  uuid REFERENCES chapters(id),
  lecture_id  uuid REFERENCES lectures(id),
  source      text NOT NULL CHECK (source IN ('code','payment','admin')),
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,                            -- null = بلا انتهاء
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired','cancelled')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (
    (target_type = 'course'  AND course_id  IS NOT NULL AND chapter_id IS NULL AND lecture_id IS NULL) OR
    (target_type = 'chapter' AND chapter_id IS NOT NULL AND course_id  IS NULL AND lecture_id IS NULL) OR
    (target_type = 'lecture' AND lecture_id IS NOT NULL AND course_id  IS NULL AND chapter_id IS NULL)
  )
);
CREATE INDEX subs_user_status_idx ON subscriptions(user_id, status, ends_at);
CREATE INDEX subs_course_idx ON subscriptions(course_id) WHERE course_id IS NOT NULL;

CREATE TABLE code_redemptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id       uuid NOT NULL REFERENCES activation_codes(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  subscription_id uuid REFERENCES subscriptions(id),
  device_id     uuid REFERENCES devices(id),
  ip            inet,
  redeemed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_id, user_id)                           -- لا يفعّل المستخدم نفس الكود مرتين
);
CREATE INDEX redemptions_user_idx ON code_redemptions(user_id);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  provider        text NOT NULL,
  provider_ref    text,                               -- معرّف العملية لدى البوابة
  amount_cents    int NOT NULL CHECK (amount_cents > 0),
  currency        char(3) NOT NULL DEFAULT 'EGP',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','refunded')),
  target_type     text CHECK (target_type IN ('course','chapter','lecture')),
  target_id       uuid,
  subscription_id uuid REFERENCES subscriptions(id),
  webhook_verified_at timestamptz,                    -- لا يُعتمد الدفع قبل تحقق الـ webhook
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_ref)
);
CREATE INDEX payments_user_idx ON payments(user_id, created_at DESC);
CREATE TRIGGER payments_upd BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- لا تُخزَّن بيانات البطاقات إطلاقًا.

-- ============ المشاهدة والتقدم ============
CREATE TABLE watch_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users(id),
  lecture_id      uuid NOT NULL REFERENCES lectures(id),
  device_id       uuid REFERENCES devices(id),
  auth_session_id uuid REFERENCES user_sessions(id),
  started_at      timestamptz NOT NULL DEFAULT now(),
  last_heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  watched_seconds int NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),  -- يحسبها الخادم
  last_position_seconds int NOT NULL DEFAULT 0 CHECK (last_position_seconds >= 0),
  was_offline     boolean NOT NULL DEFAULT false
);
CREATE INDEX watch_sessions_user_lecture_idx ON watch_sessions(user_id, lecture_id, started_at DESC);
CREATE INDEX watch_sessions_lecture_idx ON watch_sessions(lecture_id);

CREATE TABLE watch_events (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES watch_sessions(id) ON DELETE CASCADE,
  event_type  text NOT NULL CHECK (event_type IN ('play','pause','seek','rate_change','heartbeat','end','blocked_attempt')),
  position_seconds int,
  playback_rate numeric(3,2) CHECK (playback_rate IS NULL OR playback_rate BETWEEN 0.5 AND 2.0),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  meta        jsonb
);
CREATE INDEX watch_events_session_idx ON watch_events(session_id, occurred_at);

CREATE TABLE lecture_progress (
  user_id         uuid NOT NULL REFERENCES users(id),
  lecture_id      uuid NOT NULL REFERENCES lectures(id),
  watched_seconds int NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),
  max_position_seconds int NOT NULL DEFAULT 0,
  last_position_seconds int NOT NULL DEFAULT 0,
  percent         numeric(5,2) NOT NULL DEFAULT 0 CHECK (percent BETWEEN 0 AND 100),
  completed       boolean NOT NULL DEFAULT false,
  open_count      int NOT NULL DEFAULT 0,
  rates_used      numeric(3,2)[] NOT NULL DEFAULT '{}',
  blocked_attempts int NOT NULL DEFAULT 0,
  offline_status  text NOT NULL DEFAULT 'none' CHECK (offline_status IN ('none','downloaded','expired')),
  first_watched_at timestamptz,
  last_watched_at timestamptz,
  PRIMARY KEY (user_id, lecture_id)
);
CREATE INDEX progress_lecture_idx ON lecture_progress(lecture_id);

-- ============ الامتحانات ============
CREATE TABLE exams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id       uuid NOT NULL REFERENCES courses(id),
  chapter_id      uuid REFERENCES chapters(id),
  title           text NOT NULL,
  instructions    text,
  duration_minutes int NOT NULL CHECK (duration_minutes > 0),
  opens_at        timestamptz,
  closes_at       timestamptz,
  max_attempts    int NOT NULL DEFAULT 1 CHECK (max_attempts > 0),
  shuffle_questions boolean NOT NULL DEFAULT false,
  shuffle_options boolean NOT NULL DEFAULT false,
  review_policy   text NOT NULL DEFAULT 'after_submit' CHECK (review_policy IN ('never','after_submit','after_close')),
  pass_percent    numeric(5,2) NOT NULL DEFAULT 50 CHECK (pass_percent BETWEEN 0 AND 100),
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (closes_at IS NULL OR opens_at IS NULL OR closes_at > opens_at)
);
CREATE INDEX exams_course_idx ON exams(course_id);

CREATE TABLE questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id     uuid NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  body        text NOT NULL,
  image_object_key text,
  points      numeric(6,2) NOT NULL DEFAULT 1 CHECK (points > 0),
  explanation text,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX questions_exam_idx ON questions(exam_id, sort_order);

CREATE TABLE answer_options (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  body        text NOT NULL,
  is_correct  boolean NOT NULL DEFAULT false,
  explanation text,
  sort_order  int NOT NULL DEFAULT 0
);
CREATE INDEX options_question_idx ON answer_options(question_id);
-- خيار صحيح واحد على الأكثر لكل سؤال (اختيار من متعدد بإجابة واحدة)
CREATE UNIQUE INDEX options_one_correct ON answer_options(question_id) WHERE is_correct;

CREATE TABLE exam_attempts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id       uuid NOT NULL REFERENCES exams(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  attempt_no    int NOT NULL CHECK (attempt_no > 0),
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,                 -- يحسبه الخادم عند البدء
  submitted_at  timestamptz,
  status        text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','expired')),
  question_order uuid[],                              -- ترتيب عشوائي محفوظ للاستعادة
  score         numeric(7,2),
  max_score     numeric(7,2),
  percent       numeric(5,2),
  passed        boolean,
  UNIQUE (exam_id, user_id, attempt_no)
);
-- محاولة جارية واحدة فقط لكل طالب في الامتحان (يمنع التزامن)
CREATE UNIQUE INDEX attempts_one_running ON exam_attempts(exam_id, user_id) WHERE status = 'in_progress';
CREATE INDEX attempts_user_idx ON exam_attempts(user_id, started_at DESC);

CREATE TABLE student_answers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id  uuid NOT NULL REFERENCES exam_attempts(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES questions(id),
  option_id   uuid REFERENCES answer_options(id),
  is_correct  boolean,                                -- يُملأ عند التصحيح على الخادم
  points_awarded numeric(6,2),
  answered_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, question_id)
);

-- ============ الإشعارات والدعم ============
CREATE TABLE notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL,
  body        text NOT NULL,
  audience    text NOT NULL CHECK (audience IN ('user','grade','subject','course','all')),
  user_id     uuid REFERENCES users(id),
  grade_id    int REFERENCES academic_grades(id),
  subject_id  int REFERENCES subjects(id),
  course_id   uuid REFERENCES courses(id),
  deep_link   text,
  scheduled_at timestamptz,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_deliveries (
  id              bigserial PRIMARY KEY,
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id),
  device_id       uuid REFERENCES devices(id),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','read')),
  error           text,
  sent_at         timestamptz,
  read_at         timestamptz
);
CREATE INDEX deliveries_user_idx ON notification_deliveries(user_id, status);
CREATE INDEX deliveries_notif_idx ON notification_deliveries(notification_id);

CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  subject     text NOT NULL,
  message     text NOT NULL,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to uuid REFERENCES users(id),
  reply       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tickets_status_idx ON support_tickets(status, created_at DESC);
CREATE TRIGGER tickets_upd BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============ التدقيق والإعدادات ============
CREATE TABLE audit_logs (
  id          bigserial PRIMARY KEY,
  actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,                          -- مثل code.redeem, device.revoke, login.fail
  entity_type text,
  entity_id   text,
  ip          inet,
  meta        jsonb,                                  -- لا كلمات مرور ولا رموز
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_actor_idx ON audit_logs(actor_id, created_at DESC);
CREATE INDEX audit_action_idx ON audit_logs(action, created_at DESC);
CREATE INDEX audit_entity_idx ON audit_logs(entity_type, entity_id);

CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schema_migrations (
  version     text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
INSERT INTO schema_migrations(version) VALUES ('001_init');

INSERT INTO roles(id, code, name_ar) VALUES
  (1,'admin','مدير النظام'),
  (2,'content_manager','مدير محتوى'),
  (3,'teacher','مدرس'),
  (4,'student','طالب');

COMMIT;
