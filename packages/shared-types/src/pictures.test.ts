import { describe, expect, it } from 'vitest';
import { parsePictureNotes, pictureId } from './pictures.js';

describe('pictures', () => {
  const note = { id: 'leaf-parts', goal: 0, title: 'Parts of a leaf', shows: 'A leaf with its parts named.', labels: ['Petiole', 'Lamina'] };

  it('makes a short id out of a name', () => {
    expect(pictureId('Parts of a Leaf!', 'p1')).toBe('parts-of-a-leaf');
    expect(pictureId('', 'p1')).toBe('p1');
  });

  it('accepts what a browser says of the pictures for a lesson, and nothing malformed', () => {
    expect(parsePictureNotes(undefined, 3)).toEqual([]);
    expect(parsePictureNotes([note], 3)).toEqual([note]);
    expect(parsePictureNotes([{ ...note, goal: 3 }], 3)).toBeNull();
    expect(parsePictureNotes([{ ...note, id: 'Bad Id' }], 3)).toBeNull();
    expect(parsePictureNotes([{ ...note, labels: ['x'.repeat(41)] }], 3)).toBeNull();
    expect(parsePictureNotes([note, note, note, note, note], 3)).toBeNull();
    expect(parsePictureNotes('pictures', 3)).toBeNull();
  });
});

describe('pictures that build up', () => {
  const note = { id: 'germination', goal: 1, title: 'A seed germinates', shows: 'A bean seed growing into a seedling.', labels: ['Seed', 'Root', 'Shoot'] };

  it('takes the stages of a picture that builds up, two to four of them', () => {
    expect(parsePictureNotes([{ ...note, stages: ['The seed', 'The root grows', 'The shoot grows'] }], 2)).toEqual([{ ...note, stages: ['The seed', 'The root grows', 'The shoot grows'] }]);
    expect(parsePictureNotes([{ ...note, stages: ['Only one'] }], 2)).toBeNull();
    expect(parsePictureNotes([{ ...note, stages: ['a', 'b', 'c', 'd', 'e'] }], 2)).toBeNull();
  });
});
