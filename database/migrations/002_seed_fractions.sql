-- Pilot curriculum: Grade 7 Mathematics → Fractions (README sections 3, 13).
INSERT INTO curricula (id, name, board, country, language, version)
VALUES ('00000000-0000-0000-0000-000000000001', 'Pilot Mathematics', NULL, NULL, 'en', '1');

INSERT INTO subjects (id, curriculum_id, name)
VALUES ('00000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', 'Mathematics');

INSERT INTO topics (id, subject_id, name)
VALUES ('00000000-0000-0000-0000-000000000100', '00000000-0000-0000-0000-000000000010', 'Fractions');

INSERT INTO lessons (id, topic_id, title, content, difficulty)
VALUES ('00000000-0000-0000-0000-000000001000', '00000000-0000-0000-0000-000000000100',
        'What is a fraction?',
        'A fraction describes equal parts of a whole. The denominator is how many equal parts the whole is split into; the numerator is how many of those parts we take.',
        1);

INSERT INTO questions (lesson_id, question, answer, difficulty) VALUES
  ('00000000-0000-0000-0000-000000001000', 'A circle is cut into four equal pieces. If we take one piece, what fraction do we have?', '1/4', 1),
  ('00000000-0000-0000-0000-000000001000', 'A bar is split into three equal parts and two are shaded. What fraction is shaded?', '2/3', 1);
