create or replace function public.claim_participant_payment(p_submission_id uuid, p_admin_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_payment public.payments; v_recipient text;
begin
  if auth.role() <> 'service_role' then raise exception 'Service role required'; end if;
  update public.payments set status='processing', approved_by=p_admin_id,
    approved_at=coalesce(approved_at,now()), failure_reason=null, updated_at=now()
  where submission_id=p_submission_id and status='eligible' returning * into v_payment;
  if v_payment.id is null then raise exception 'No eligible payment exists or it is already being processed'; end if;
  select provider_recipient_code into v_recipient from public.payout_accounts
    where id=v_payment.payout_account_id and verified_at is not null;
  if nullif(trim(coalesce(v_recipient,'')),'') is null then
    update public.payments set status='failed',failure_reason='Verified payout recipient is unavailable',updated_at=now() where id=v_payment.id;
    raise exception 'Verified payout recipient is unavailable';
  end if;
  return jsonb_build_object('id',v_payment.id,'submission_id',v_payment.submission_id,'user_id',v_payment.user_id,
    'amount',v_payment.amount,'currency',v_payment.currency,'recipient',v_recipient,
    'reference',lower('nv-'||replace(v_payment.id::text,'-','')));
end; $$;
revoke all on function public.claim_participant_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_participant_payment(uuid,uuid) to service_role;
