-- Enforce wallet transaction direction and amount integrity

alter table public.wallet_transactions
  add column if not exists direction text;

update public.wallet_transactions
set direction = case
  when amount >= 0 then 'credit'
  else 'debit'
end
where direction is null;

alter table public.wallet_transactions
  alter column direction set not null;

alter table public.wallet_transactions
  alter column direction set default 'debit';

alter table public.wallet_transactions
  add constraint if not exists wallet_transactions_direction_check
    check (direction in ('debit', 'credit'));

alter table public.wallet_transactions
  add constraint if not exists wallet_transactions_amount_direction_check
    check (
      (direction = 'debit' and amount <= 0)
      or (direction = 'credit' and amount >= 0)
    );

create or replace function public.wallet_transactions_enforce_direction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction not in ('debit', 'credit') then
    raise exception 'Invalid transaction direction: %', new.direction;
  end if;

  if new.direction = 'debit' and new.amount > 0 then
    raise exception 'Debit transactions must have a non-positive amount';
  end if;

  if new.direction = 'credit' and new.amount < 0 then
    raise exception 'Credit transactions must have a non-negative amount';
  end if;

  return new;
end;
$$;

drop trigger if exists wallet_transactions_enforce_direction on public.wallet_transactions;

create trigger wallet_transactions_enforce_direction
  before insert or update on public.wallet_transactions
  for each row
  execute function public.wallet_transactions_enforce_direction();

comment on column public.wallet_transactions.direction is 'Indicates whether the transaction debits or credits a user wallet.';
