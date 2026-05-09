do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'assistances'
      and column_name = 'productId'
      and is_nullable = 'NO'
  ) then
    alter table public.assistances alter column "productId" drop not null;
  end if;
end $$;

