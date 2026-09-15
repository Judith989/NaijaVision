alter table public.reviewer_payments add column if not exists provider text;
alter table public.reviewer_payments add column if not exists provider_transaction_reference text;
alter table public.reviewer_payments add column if not exists processed_at timestamptz;
alter table public.reviewer_payments add column if not exists failure_reason text;
create unique index if not exists reviewer_payments_provider_reference_unique
  on public.reviewer_payments(provider_transaction_reference) where provider_transaction_reference is not null;

create or replace function public.claim_reviewer_payment(p_payment_id uuid,p_admin_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_payment public.reviewer_payments; v_recipient text;
begin
  if auth.role()<>'service_role' then raise exception 'Service role required'; end if;
  update public.reviewer_payments set status='processing',approved_by=p_admin_id,
    approved_at=coalesce(approved_at,now()),failure_reason=null,updated_at=now()
  where id=p_payment_id and status in ('eligible','failed') returning * into v_payment;
  if v_payment.id is null then raise exception 'Reviewer payment is not eligible or is already processing'; end if;
  select provider_recipient_code into v_recipient from public.payout_accounts
    where id=v_payment.payout_account_id and verified_at is not null;
  if nullif(trim(coalesce(v_recipient,'')),'') is null then raise exception 'Reviewer needs a verified payout account'; end if;
  return jsonb_build_object('id',v_payment.id,'reviewer_id',v_payment.reviewer_id,'amount',v_payment.amount,
    'currency',v_payment.currency,'recipient',v_recipient,'reference',lower('nvr-'||replace(v_payment.id::text,'-','')));
end; $$;
revoke all on function public.claim_reviewer_payment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.claim_reviewer_payment(uuid,uuid) to service_role;
