-- Storage: a public bucket for creator avatars shown on the media kit.
-- Files live under <Clerk user id>/..., and only that user can write there.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('creator-assets', 'creator-assets', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy creator_assets_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));

create policy creator_assets_update on storage.objects
  for update to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'))
  with check (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));

create policy creator_assets_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));

-- Public buckets serve files by URL without a policy; this lets the owner list their own folder.
create policy creator_assets_select_own on storage.objects
  for select to authenticated
  using (bucket_id = 'creator-assets' and (storage.foldername(name))[1] = ((select auth.jwt()) ->> 'sub'));
