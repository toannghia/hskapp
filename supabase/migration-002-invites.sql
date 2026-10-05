-- Bổ sung: quản trị thêm tài khoản trước (học viên / giáo viên) và xếp vào lớp.
-- Chạy toàn bộ tệp này một lần trong Supabase → SQL Editor, SAU khi đã chạy schema.sql. Chạy lại cũng không sao.
--
-- App chỉ đăng nhập bằng Google nên quản trị không tạo mật khẩu cho ai. Thay vào đó quản trị ghi sẵn email,
-- vai trò và lớp; khi người có email đó đăng nhập Google lần đầu, vai trò và lớp được áp dụng tự động.
-- Nếu người đó đã từng đăng nhập thì thay đổi có hiệu lực ngay.

create table if not exists public.invites (
  email text primary key check (email = lower(email)),
  full_name text,
  role text not null default 'student' check (role in ('student', 'teacher')),
  class_id uuid references public.classes on delete set null,
  created_by uuid default auth.uid() references public.profiles on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);
alter table public.invites enable row level security;
drop policy if exists invites_admin on public.invites;
create policy invites_admin on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Áp dụng lời mời (nếu có) cho một người dùng đã có hồ sơ.
create or replace function public.apply_invite(p_user uuid, p_email text) returns boolean
language plpgsql security definer set search_path = public as $$
declare inv public.invites%rowtype;
begin
  select * into inv from invites where email = lower(p_email);
  if not found then return false; end if;
  update profiles
     set role = case when role = 'admin' then role else inv.role end,
         full_name = coalesce(nullif(full_name, ''), inv.full_name)
   where id = p_user;
  if inv.class_id is not null then
    insert into class_members (class_id, user_id) values (inv.class_id, p_user) on conflict do nothing;
  end if;
  update invites set accepted_at = now() where email = inv.email;
  return true;
end $$;

-- Khi có người đăng nhập Google lần đầu: tạo hồ sơ rồi áp dụng lời mời nếu email đã được quản trị thêm trước.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
          new.raw_user_meta_data->>'avatar_url');
  perform public.apply_invite(new.id, new.email);
  return new;
end $$;

-- Quản trị thêm một tài khoản. Trả về 'applied' nếu người đó đã có tài khoản (áp dụng ngay),
-- 'pending' nếu phải chờ họ đăng nhập lần đầu.
create or replace function public.admin_add_account(p_email text, p_name text, p_role text, p_class uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_email text := lower(trim(p_email)); v_user uuid;
begin
  if not public.is_admin() then raise exception 'Chỉ quản trị mới được thêm tài khoản'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email không hợp lệ'; end if;
  if p_role not in ('student', 'teacher') then raise exception 'Vai trò không hợp lệ'; end if;
  insert into invites (email, full_name, role, class_id, accepted_at)
    values (v_email, nullif(trim(p_name), ''), p_role, p_class, null)
    on conflict (email) do update
      set full_name = excluded.full_name, role = excluded.role, class_id = excluded.class_id,
          accepted_at = null, created_at = now();
  select id into v_user from profiles where lower(email) = v_email;
  if v_user is null then return 'pending'; end if;
  perform public.apply_invite(v_user, v_email);
  return 'applied';
end $$;
revoke execute on function public.admin_add_account(text, text, text, uuid) from anon, public;
revoke execute on function public.apply_invite(uuid, text) from anon, public, authenticated;
grant execute on function public.admin_add_account(text, text, text, uuid) to authenticated;

-- Quản trị (và giáo viên với lớp của mình) được xếp trực tiếp một người đã có tài khoản vào lớp.
drop policy if exists members_insert on public.class_members;
create policy members_insert on public.class_members for insert to authenticated
  with check (public.is_admin() or public.owns_class(class_id));
