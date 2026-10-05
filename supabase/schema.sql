-- Cơ sở dữ liệu cho bản online của app ôn HSK5 (Supabase / Postgres).
-- Chạy toàn bộ tệp này một lần trong Supabase → SQL Editor của một dự án mới.
-- Nguyên tắc: mọi bảng đều bật RLS; học viên chỉ đọc được dữ liệu của mình,
-- giáo viên chỉ đọc được dữ liệu của học viên trong lớp mình dạy, quản trị đọc được tất cả.

-- ---------- Hồ sơ người dùng ----------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  role text not null default 'student' check (role in ('student', 'teacher', 'admin')),
  created_at timestamptz not null default now()
);

-- Tự tạo hồ sơ khi có người đăng nhập Google lần đầu.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'avatar_url');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Lớp học ----------
create table public.classes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  teacher_id uuid not null references public.profiles on delete restrict,
  created_at timestamptz not null default now()
);
create table public.class_members (
  class_id uuid not null references public.classes on delete cascade,
  user_id uuid not null references public.profiles on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, user_id)
);

-- ---------- Hàm kiểm tra quyền (security definer để các chính sách RLS không gọi vòng nhau) ----------
create function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid()
$$;
create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;
create function public.owns_class(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = p_class and teacher_id = auth.uid())
$$;
create function public.is_member_of(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_members where class_id = p_class and user_id = auth.uid())
$$;
-- Người đang đăng nhập có dạy học viên này không.
create function public.teaches(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_members m join classes c on c.id = m.class_id
                 where m.user_id = p_student and c.teacher_id = auth.uid())
$$;
-- Người đang đăng nhập có học lớp của giáo viên này không (để thấy tên người chấm bài).
create function public.taught_by(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from class_members m join classes c on c.id = m.class_id
                 where m.user_id = auth.uid() and c.teacher_id = p_teacher)
$$;
-- Lớp kín: chỉ thành viên của một lớp, giáo viên hoặc quản trị mới xem được nội dung bài học.
create function public.has_access() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('teacher', 'admin'), false)
      or exists (select 1 from class_members where user_id = auth.uid())
$$;

-- Chỉ quản trị được đổi vai trò. Chạy trực tiếp trong SQL Editor (không có người đăng nhập) thì được phép,
-- để gán quản trị viên đầu tiên.
create function public.guard_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Chỉ quản trị mới được đổi vai trò';
  end if;
  return new;
end $$;
create trigger profiles_guard_role before update on public.profiles
  for each row execute function public.guard_role();

-- Học viên vào lớp bằng mã lớp.
create function public.join_class(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_class uuid;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập'; end if;
  select id into v_class from classes where upper(code) = upper(trim(p_code));
  if v_class is null then raise exception 'Mã lớp không đúng'; end if;
  insert into class_members (class_id, user_id) values (v_class, auth.uid()) on conflict do nothing;
  return v_class;
end $$;

-- ---------- Tiến độ học ----------
-- Mỗi người một bản ghi: thẻ ôn, nhật ký, bài làm, sổ từ (cùng cấu trúc với bản chạy trên máy).
create table public.progress (
  user_id uuid primary key references public.profiles on delete cascade,
  doc jsonb not null default '{}'::jsonb,
  rev integer not null default 0,
  updated_at timestamptz not null default now()
);
-- Mỗi ngày giữ lại trạng thái trước lần ghi đầu tiên trong ngày, để khôi phục khi cần.
create table public.progress_history (
  user_id uuid not null references public.profiles on delete cascade,
  day date not null,
  doc jsonb not null,
  rev integer not null,
  primary key (user_id, day)
);

-- Ghi tiến độ có kiểm tra phiên bản: nếu thiết bị khác đã ghi trước thì trả về bản hiện có để gộp.
create function public.save_progress(p_doc jsonb, p_rev integer) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cur public.progress%rowtype;
begin
  if auth.uid() is null then raise exception 'Chưa đăng nhập'; end if;
  select * into cur from progress where user_id = auth.uid() for update;
  if not found then
    insert into progress (user_id, doc, rev) values (auth.uid(), p_doc, 1);
    return jsonb_build_object('rev', 1);
  end if;
  if cur.rev <> p_rev then
    return jsonb_build_object('conflict', true, 'rev', cur.rev, 'doc', cur.doc);
  end if;
  insert into progress_history (user_id, day, doc, rev)
    values (auth.uid(), current_date, cur.doc, cur.rev) on conflict do nothing;
  update progress set doc = p_doc, rev = cur.rev + 1, updated_at = now() where user_id = auth.uid();
  return jsonb_build_object('rev', cur.rev + 1);
end $$;

-- ---------- Bài viết nộp cho giáo viên và phần chấm ----------
-- Mỗi lần nộp là một dòng mới, không sửa đè, để giữ được mọi bản đã viết.
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles on delete cascade,
  lesson_id integer not null,
  exercise_id text not null,
  item_index integer not null,
  prompt text,
  content text not null,
  created_at timestamptz not null default now()
);
create index submissions_user_idx on public.submissions (user_id, created_at desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.submissions on delete cascade,
  teacher_id uuid not null default auth.uid() references public.profiles on delete restrict,
  corrected text,
  comment text,
  score integer check (score between 0 and 10),
  created_at timestamptz not null default now()
);
create index reviews_submission_idx on public.reviews (submission_id);

-- ---------- Nội dung bài học (quản trị nạp vào, không nằm trong mã nguồn) ----------
create table public.lessons (
  id integer primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- Chính sách truy cập ----------
alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_members enable row level security;
alter table public.progress enable row level security;
alter table public.progress_history enable row level security;
alter table public.submissions enable row level security;
alter table public.reviews enable row level security;
alter table public.lessons enable row level security;

create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin() or public.teaches(id) or public.taught_by(id));
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());

create policy classes_select on public.classes for select to authenticated
  using (teacher_id = auth.uid() or public.is_admin() or public.is_member_of(id));
create policy classes_insert on public.classes for insert to authenticated
  with check (teacher_id = auth.uid() and public.my_role() in ('teacher', 'admin'));
create policy classes_update on public.classes for update to authenticated
  using (teacher_id = auth.uid() or public.is_admin()) with check (teacher_id = auth.uid() or public.is_admin());
create policy classes_delete on public.classes for delete to authenticated
  using (teacher_id = auth.uid() or public.is_admin());

-- Vào lớp chỉ qua hàm join_class, nên không có chính sách insert.
create policy members_select on public.class_members for select to authenticated
  using (user_id = auth.uid() or public.owns_class(class_id) or public.is_admin());
create policy members_delete on public.class_members for delete to authenticated
  using (user_id = auth.uid() or public.owns_class(class_id) or public.is_admin());

-- Ghi tiến độ chỉ qua hàm save_progress, nên không có chính sách insert/update.
create policy progress_select on public.progress for select to authenticated
  using (user_id = auth.uid() or public.teaches(user_id) or public.is_admin());
create policy history_select on public.progress_history for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy submissions_select on public.submissions for select to authenticated
  using (user_id = auth.uid() or public.teaches(user_id) or public.is_admin());
create policy submissions_insert on public.submissions for insert to authenticated
  with check (user_id = auth.uid());

create policy reviews_select on public.reviews for select to authenticated
  using (teacher_id = auth.uid() or public.is_admin()
         or exists (select 1 from public.submissions s where s.id = submission_id and s.user_id = auth.uid()));
create policy reviews_insert on public.reviews for insert to authenticated
  with check (teacher_id = auth.uid()
              and exists (select 1 from public.submissions s
                          where s.id = submission_id and (public.teaches(s.user_id) or public.is_admin())));
create policy reviews_update on public.reviews for update to authenticated
  using (teacher_id = auth.uid()) with check (teacher_id = auth.uid());

create policy lessons_select on public.lessons for select to authenticated using (public.has_access());
create policy lessons_write on public.lessons for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Người chưa đăng nhập không gọi được các hàm ghi dữ liệu.
revoke execute on function public.join_class(text) from anon, public;
revoke execute on function public.save_progress(jsonb, integer) from anon, public;
grant execute on function public.join_class(text) to authenticated;
grant execute on function public.save_progress(jsonb, integer) to authenticated;

-- ---------- Kho âm thanh và hình ảnh (riêng tư, chỉ người có quyền truy cập mới tải được) ----------
insert into storage.buckets (id, name, public) values ('media', 'media', false) on conflict do nothing;
create policy media_read on storage.objects for select to authenticated
  using (bucket_id = 'media' and public.has_access());
create policy media_write on storage.objects for all to authenticated
  using (bucket_id = 'media' and public.is_admin()) with check (bucket_id = 'media' and public.is_admin());

-- ---------- Gán quản trị viên đầu tiên ----------
-- Sau khi bạn đăng nhập vào app lần đầu bằng Google, chạy riêng dòng dưới (thay email của bạn):
-- update public.profiles set role = 'admin' where email = 'email-cua-ban@gmail.com';

-- Sau tệp này, chạy tiếp supabase/migration-002-invites.sql để có chức năng quản trị thêm tài khoản và xếp lớp.
