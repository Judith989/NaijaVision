create or replace function public.require_clip_review_comments()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.decision in ('rejected', 'changes_requested')
     and length(trim(coalesce(new.comments, ''))) < 10 then
    raise exception 'Add a comment of at least 10 characters explaining the decline or redo request';
  end if;
  if new.decision = 'approved' then
    new.comments := null;
  else
    new.comments := trim(new.comments);
  end if;
  return new;
end;
$$;

drop trigger if exists require_clip_review_comments on public.reviews;
create trigger require_clip_review_comments
before insert or update of decision, comments on public.reviews
for each row execute function public.require_clip_review_comments();
