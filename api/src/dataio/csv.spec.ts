import { describe, expect, it } from 'vitest';
import { csvCell, detectDelimiter, parseCsv, toCsv } from './csv.js';

describe('CSV output', () => {
  it('quotes only when needed', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell(3.5)).toBe('3.5');
    expect(csvCell(-2)).toBe('-2');
  });

  it('defuses spreadsheet formulas', () => {
    for (const evil of ['=SUM(A1)', '+1+1', '-2+3', '@cmd', '\tx', '=HYPERLINK("http://x")']) {
      expect(csvCell(evil).replace(/^"/, '')).toMatch(/^'/);
    }
    expect(csvCell('ok = fine')).toBe('ok = fine');
  });

  it('joins rows with CRLF', () => {
    expect(toCsv([['a', 'b'], ['1', '2,3']])).toBe('a,b\r\n1,"2,3"\r\n');
  });
});

describe('CSV input', () => {
  it('reads quoted fields, escaped quotes and embedded line breaks', () => {
    expect(parseCsv('a,b\r\n"x, y","say ""hi"""\r\n"line1\nline2",z\r\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['line1\nline2', 'z']]);
  });
  it('handles a BOM, missing final newline, empty fields and blank lines', () => {
    expect(parseCsv('﻿a,b,c\n1,,3\n\n4,5,6')).toEqual([['a', 'b', 'c'], ['1', '', '3'], ['4', '5', '6']]);
    expect(parseCsv('')).toEqual([]);
  });
  it('detects semicolons and tabs', () => {
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a\tb\tc')).toBe('\t');
    expect(detectDelimiter('"a;b",c')).toBe(',');
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('round-trips what it writes', () => {
    const rows = [['Title', 'Notes'], ['A "quoted", odd', 'multi\nline'], ['', 'x']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});
