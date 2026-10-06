-- Bổ sung: giáo viên được quản trị xếp vào một lớp thì dạy lớp đó (một lớp có thể có nhiều giáo viên).
-- Trước đây chỉ người tạo lớp mới được coi là giáo viên của lớp, nên giáo viên được thêm vào lớp
-- không thấy danh sách học viên. Chạy toàn bộ tệp này một lần trong Supabase → SQL Editor. Chạy lại cũng không sao.

-- Người đang đăng nhập có dạy lớp này không: là người tạo lớp, hoặc là giáo viên được xếp vào lớp.
create or replace function public.owns_class(p_class uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from classes where id = p_class and teacher_id = auth.uid())
      or (coalesce(public.my_role() = 'teacher', false)
          and exists (select 1 from class_members where class_id = p_class and user_id = auth.uid()))
$$;

-- Người đang đăng nhập có dạy học viên này không.
create or replace function public.teaches(p_student uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from class_members m join classes c on c.id = m.class_id
    where m.user_id = p_student
      and (c.teacher_id = auth.uid()
           or (coalesce(public.my_role() = 'teacher', false)
               and exists (select 1 from class_members t where t.class_id = c.id and t.user_id = auth.uid()))))
$$;

-- Người đang đăng nhập có học lớp của giáo viên này không (để thấy tên người chữa bài, người gửi lời nhắc).
create or replace function public.taught_by(p_teacher uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from class_members m join classes c on c.id = m.class_id
    where m.user_id = auth.uid()
      and (c.teacher_id = p_teacher
           or exists (select 1 from class_members t join profiles p on p.id = t.user_id
                      where t.class_id = c.id and t.user_id = p_teacher and p.role = 'teacher')))
$$;
