import { describe, expect, it } from 'vitest';
import { reportCanvasWidth } from '../src/views/report-designer/reportGeometry';

describe('reportCanvasWidth', () => {
  it('subtracts left and right margins when margins are asymmetric', () => {
    expect(reportCanvasWidth({ size: 'A4', margins: [10, 20, 30, 40] })).toBe(535);
  });

  it('uses the oriented page width', () => {
    expect(reportCanvasWidth({ size: 'Letter', orientation: 'landscape', margins: [5, 12, 7, 18] })).toBe(762);
  });
});
