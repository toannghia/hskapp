-- Bổ sung: giáo viên đánh giá và xác nhận đã xem bài tập của học viên.
-- Chạy toàn bộ tệp này một lần trong Supabase → SQL Editor (sau schema.sql). Chạy lại cũng không sao.
-- Mỗi học viên, mỗi bài tập có một dòng: thời điểm giáo viên xem gần nhất, xếp loại và nhận xét.
-- Nếu sau đó học viên làm lại bài, bài sẽ hiện lại ở mục chưa xem (app so thời điểm làm với seen_at).

create table if not exists public.exercise_reviews (
  student_id uuid not null references public.profiles on delete cascade,
  exercise_id text not null,
  lesson_id integer not null,
  teacher_id uuid not null default auth.uid() references public.profiles on delete cascade,
  rating text check (rating in ('good', 'ok', 'redo')),
  comment text check (comment is null or char_length(comment) <= 2000),
  seen_at timestamptz not null default now(),
  primary key (student_id, exercise_id)
);
alter table public.exercise_reviews enable row level security;

drop policy if exists exercise_reviews_select on public.exercise_reviews;
create policy exercise_reviews_select on public.exercise_reviews for select to authenticated
  using (student_id = auth.uid() or public.teaches(student_id) or public.is_admin());
drop policy if exists exercise_reviews_insert on public.exercise_reviews;
create policy exercise_reviews_insert on public.exercise_reviews for insert to authenticated
  with check (teacher_id = auth.uid() and (public.teaches(student_id) or public.is_admin()));
drop policy if exists exercise_reviews_update on public.exercise_reviews;
create policy exercise_reviews_update on public.exercise_reviews for update to authenticated
  using (public.teaches(student_id) or public.is_admin())
  with check (teacher_id = auth.uid() and (public.teaches(student_id) or public.is_admin()));
