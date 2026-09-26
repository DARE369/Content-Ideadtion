-- What buyers ask and what makes them hesitate. Ideas answer these directly.
set search_path = ideation, public, extensions;

alter table brand_brains
  add column if not exists buyer_questions text[] not null default '{}',
  add column if not exists objections text[] not null default '{}';
