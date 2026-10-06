-- Bổ sung: giáo viên gửi lời nhắc cho học viên trong lớp mình.
-- Chạy toàn bộ tệp này một lần trong Supabase → SQL Editor (sau schema.sql). Chạy lại cũng không sao.

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles on delete cascade,
  teacher_id uuid not null default auth.uid() references public.profiles on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists notes_student_idx on public.notes (student_id, created_at desc);
alter table public.notes enable row level security;

drop policy if exists notes_select on public.notes;
create policy notes_select on public.notes for select to authenticated
  using (student_id = auth.uid() or teacher_id = auth.uid() or public.is_admin());
-- Chỉ giáo viên đang dạy học viên đó (hoặc quản trị) mới gửi được lời nhắc.
drop policy if exists notes_insert on public.notes;
create policy notes_insert on public.notes for insert to authenticated
  with check (teacher_id = auth.uid() and (public.teaches(student_id) or public.is_admin()));
drop policy if exists notes_delete on public.notes;
create policy notes_delete on public.notes for delete to authenticated
  using (teacher_id = auth.uid() or public.is_admin());

-- Học viên đánh dấu đã đọc lời nhắc của mình (không sửa được nội dung).
create or replace function public.mark_notes_read() returns void
language sql security definer set search_path = public as $$
  update notes set read_at = now() where student_id = auth.uid() and read_at is null
$$;
revoke execute on function public.mark_notes_read() from anon, public;
grant execute on function public.mark_notes_read() to authenticated;
