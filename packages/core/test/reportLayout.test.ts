import { describe, expect, it } from 'vitest';
import { pointsToUnit, reportPageDimensions, unitToPoints, validateReportLayout, type ReportMeta } from '../src/index.js';

const report = (patch: Partial<ReportMeta> = {}): ReportMeta => ({
  kind: 'report', name: 'TEST_Report', dataSource: 'TEST_Table', layoutVersion: 2,
  page: { size: 'A4', margins: [10, 20, 30, 40] },
  bands: [{ kind: 'detail', height: 100, elements: [] }], ...patch,
});

describe('report layout v2', () => {
  it('uses canonical points without unit conversion drift', () => {
    const point = 137.25;
    for (const unit of ['cm', 'in', 'px'] as const) expect(unitToPoints(pointsToUnit(point, unit), unit)).toBeCloseTo(point, 10);
  });

  it('supports all paper sizes and custom orientation', () => {
    expect(reportPageDimensions({ size: 'A3' })).toEqual([842, 1191]);
    expect(reportPageDimensions({ size: 'A5', orientation: 'landscape' })).toEqual([595, 420]);
    expect(reportPageDimensions({ size: 'Legal' })).toEqual([612, 1008]);
    expect(reportPageDimensions({ size: 'Custom', width: 300, height: 500, orientation: 'landscape' })).toEqual([500, 300]);
  });

  it('checks asymmetric left/right margins, band height, and tablix width', () => {
    const value = report({ bands: [{ kind: 'detail', height: 20, elements: [{ id: 'e', type: 'text', x: 530, y: 10, width: 10, height: 20 }], layout: 'tablix', tablix: { columns: [{ field: 'a', width: 540 }] } }] });
    const codes = validateReportLayout(value).map((item) => item.code);
    expect(codes).toContain('element_width'); // usable width = 595 - right 20 - left 40 = 535
    expect(codes).toContain('element_height');
    expect(codes).toContain('tablix_width');
  });

  it('keeps legacy overflow previewable as warnings but makes v2 strict', () => {
    const overflowing = report({ layoutVersion: 1, bands: [{ kind: 'detail', height: 10, elements: [{ id: 'e', type: 'text', x: 0, y: 8, width: 10, height: 8 }] }] });
    expect(validateReportLayout(overflowing)[0]?.severity).toBe('warning');
    expect(validateReportLayout({ ...overflowing, layoutVersion: 2 })[0]?.severity).toBe('error');
  });
});
