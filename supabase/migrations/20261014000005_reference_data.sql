-- Reference data (not demo data): the network-wide subject dictionary.
-- HQ can edit or extend it in Settings -> Subjects.
insert into public.subjects (code, name_kk, name_ru) values
  ('math',       'Математика',            'Математика'),
  ('algebra',    'Алгебра',               'Алгебра'),
  ('geometry',   'Геометрия',             'Геометрия'),
  ('physics',    'Физика',                'Физика'),
  ('chemistry',  'Химия',                 'Химия'),
  ('biology',    'Биология',              'Биология'),
  ('geography',  'География',             'География'),
  ('history_kz', 'Қазақстан тарихы',      'История Казахстана'),
  ('world_history', 'Дүниежүзі тарихы',   'Всемирная история'),
  ('kazakh',     'Қазақ тілі',            'Казахский язык'),
  ('kazakh_lit', 'Қазақ әдебиеті',        'Казахская литература'),
  ('russian',    'Орыс тілі',             'Русский язык'),
  ('russian_lit','Орыс әдебиеті',         'Русская литература'),
  ('english',    'Ағылшын тілі',          'Английский язык'),
  ('informatics','Информатика',           'Информатика'),
  ('math_literacy', 'Математикалық сауаттылық', 'Математическая грамотность'),
  ('reading_literacy', 'Оқу сауаттылығы', 'Грамотность чтения'),
  ('primary',    'Бастауыш сынып',        'Начальные классы')
on conflict (code) do nothing;
