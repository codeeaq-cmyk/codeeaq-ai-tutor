import { WhiteboardService } from './whiteboard.service.js';

describe('WhiteboardService', () => {
  const service = new WhiteboardService();

  it('keeps predefined actions', () => {
    const actions = [
      { type: 'draw_circle', id: 'pizza', x: 400, y: 250, radius: 120 },
      { type: 'divide_circle', targetId: 'pizza', parts: 4 },
    ];
    expect(service.sanitize(actions)).toEqual(actions);
  });

  it('drops unknown or malformed actions', () => {
    const actions = [
      { type: 'run_script', code: 'alert(1)' },
      'draw_circle',
      null,
      { type: 'clear' },
    ];
    expect(service.sanitize(actions)).toEqual([{ type: 'clear' }]);
  });

  it('returns an empty list for non-array input', () => {
    expect(service.sanitize({ type: 'clear' })).toEqual([]);
  });
});
