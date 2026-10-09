create or replace function public.mark_reviewer_payment_paid(
  p_payment_id uuid,
  p_reference text
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment public.reviewer_payments;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if length(trim(coalesce(p_reference, ''))) < 3 then raise exception 'Enter the bank or payment reference'; end if;

  select * into v_payment from public.reviewer_payments where id=p_payment_id for update;
  if v_payment.id is null then raise exception 'Reviewer payment not found'; end if;
  if v_payment.status='paid' then raise exception 'Reviewer payment is already marked paid'; end if;
  if v_payment.status not in ('eligible','processing','failed') then raise exception 'Reviewer payment is not ready to be marked paid'; end if;

  update public.reviewer_payments set
    status='paid', provider=coalesce(provider,'manual'),
    provider_transaction_reference=trim(p_reference), approved_by=auth.uid(),
    approved_at=coalesce(approved_at,now()), processed_at=now(), paid_at=now(),
    failure_reason=null, updated_at=now()
  where id=p_payment_id;

  insert into public.notifications(user_id,type,title,message)
  values(v_payment.reviewer_id,'reviewer_payment_paid','Reviewer compensation sent',
    'Your reviewer compensation of '||v_payment.amount||' '||v_payment.currency||' has been marked paid.');

  perform public.write_audit_event('reviewer_payment.manually_marked_paid','reviewer_payment',v_payment.id::text,null,
    jsonb_build_object('reference',trim(p_reference),'amount',v_payment.amount,'currency',v_payment.currency,'submission_id',v_payment.submission_id));
end;
$$;

revoke all on function public.mark_reviewer_payment_paid(uuid,text) from public, anon;
grant execute on function public.mark_reviewer_payment_paid(uuid,text) to authenticated;
