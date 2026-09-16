alter table public.recordings add column if not exists archived_at timestamptz;
alter table public.recordings add column if not exists archive_path text;
alter table public.recordings add column if not exists storage_deleted_at timestamptz;

create or replace function public.mark_participant_payment_paid(
  p_payment_id uuid,
  p_reference text
) returns void
language plpgsql security definer set search_path=''
as $$
declare v_payment public.payments;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if length(trim(coalesce(p_reference,''))) < 3 then raise exception 'Enter the bank or payment reference'; end if;
  select * into v_payment from public.payments where id=p_payment_id for update;
  if v_payment.id is null then raise exception 'Payment not found'; end if;
  if v_payment.status='paid' then raise exception 'Payment is already marked paid'; end if;
  if v_payment.status not in ('eligible','processing','failed') then raise exception 'Payment is not ready to be marked paid'; end if;
  update public.payments set status='paid',provider=coalesce(provider,'manual'),
    provider_transaction_reference=trim(p_reference),approved_by=auth.uid(),
    approved_at=coalesce(approved_at,now()),processed_at=now(),failure_reason=null,updated_at=now()
  where id=p_payment_id;
  update public.submissions set status='paid',paid_at=now(),updated_at=now() where id=v_payment.submission_id;
  insert into public.notifications(user_id,type,title,message)
  values(v_payment.user_id,'payment_paid','Compensation sent',
    'Your '||v_payment.amount||' '||v_payment.currency||' compensation has been marked paid.');
  perform public.write_audit_event('payment.manually_marked_paid','payment',v_payment.id::text,null,
    jsonb_build_object('reference',trim(p_reference),'amount',v_payment.amount,'currency',v_payment.currency));
end; $$;
grant execute on function public.mark_participant_payment_paid(uuid,text) to authenticated;
