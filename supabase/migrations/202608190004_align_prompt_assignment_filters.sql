update public.prompts
set prompt_type = 'Reading',
    language = 'Nigerian English',
    language_sequence = array['Nigerian English']::text[]
where id like 'NUM-%';

update public.prompts
set prompt_type = 'Code-switching',
    language = 'Igbo + Nigerian English',
    language_sequence = array['Igbo', 'Nigerian English']::text[]
where id = 'SAFE-CS-001';

update public.prompts
set prompt_type = 'Code-switching',
    language = 'Yorùbá + Nigerian Pidgin',
    language_sequence = array['Yorùbá', 'Nigerian Pidgin']::text[]
where id = 'SAFE-CS-002';

update public.prompts
set prompt_type = 'Code-switching',
    language = 'Hausa + Nigerian English',
    language_sequence = array['Hausa', 'Nigerian English']::text[]
where id = 'SAFE-CS-003';

update public.prompts
set prompt_type = 'Code-switching',
    language = 'Nigerian Pidgin + Nigerian English',
    language_sequence = array['Nigerian Pidgin', 'Nigerian English']::text[]
where id = 'SAFE-CS-004';
