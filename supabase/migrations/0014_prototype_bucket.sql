-- UI prototype versions — an engine card's "latest HTML prototype" panel.
--
-- Deliberately no new table. A Storage object's own row in storage.objects already
-- carries a path and an upload timestamp, and Supabase Storage already supports custom
-- metadata per object — so `prototypes/{engineKey}/v{N}.html` plus a `figma_url` metadata
-- key is the whole schema. "Latest" is never written down anywhere: it's always
-- max(parsed version) at read time, so it can never drift from what Storage actually
-- holds, and a file landing in the bucket by any path (this app, the Supabase dashboard,
-- a script run by hand) is picked up identically — there is no second place to update.
--
-- Private, matching pm-files' own posture: no anon policy of any kind, so anon SELECT
-- returns nothing and anon cannot write — every read and write here goes through the
-- service-role credential from a Server Action or script, same boundary as every other
-- write in this layer.

insert into storage.buckets (id, name, public)
values ('prototypes', 'prototypes', false)
on conflict (id) do nothing;
