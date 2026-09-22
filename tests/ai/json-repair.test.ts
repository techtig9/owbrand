import { describe, it, expect } from 'vitest';
import {
  parseJsonLoosely,
  stripCodeFence,
  extractBalancedJson,
  removeTrailingCommas,
  stripJsonComments,
} from '@/lib/ai/json-repair';

/**
 * Deterministic JSON repair.
 *
 * The property that matters most is the NEGATIVE one: repair must never invent
 * structure. Five routes previously did a bare JSON.parse on model output and
 * wrote the result straight to the database — a repair layer that "helpfully"
 * closed a truncated object would turn that into silently corrupt data instead
 * of an honest retry.
 */
describe('parseJsonLoosely — happy path', () => {
  it('parses clean JSON without any repair', () => {
    const result = parseJsonLoosely('{"a":1,"b":"two"}');
    expect(result?.value).toEqual({ a: 1, b: 'two' });
    expect(result?.repairs).toEqual([]);
  });

  it('parses arrays', () => {
    expect(parseJsonLoosely('[1,2,3]')?.value).toEqual([1, 2, 3]);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseJsonLoosely('\n  {"a":1}  \n')?.value).toEqual({ a: 1 });
  });
});

describe('parseJsonLoosely — repairs', () => {
  it('strips a ```json fence', () => {
    const result = parseJsonLoosely('```json\n{"a":1}\n```');
    expect(result?.value).toEqual({ a: 1 });
    expect(result?.repairs).toContain('stripped_code_fence');
  });

  it('strips a bare ``` fence', () => {
    expect(parseJsonLoosely('```\n{"a":1}\n```')?.value).toEqual({ a: 1 });
  });

  it('discards prose around the JSON', () => {
    const result = parseJsonLoosely('Here is the brand:\n{"name":"X"}\nLet me know if you need changes.');
    expect(result?.value).toEqual({ name: 'X' });
    expect(result?.repairs).toContain('extracted_json_span');
  });

  it('removes trailing commas', () => {
    const result = parseJsonLoosely('{"a":1,"b":[1,2,],}');
    expect(result?.value).toEqual({ a: 1, b: [1, 2] });
    expect(result?.repairs).toContain('removed_trailing_commas');
  });

  it('strips comments', () => {
    const result = parseJsonLoosely('{\n// the name\n"a":1\n/* block */\n}');
    expect(result?.value).toEqual({ a: 1 });
    expect(result?.repairs).toContain('stripped_comments');
  });

  it('combines repairs when several are needed', () => {
    const result = parseJsonLoosely('```json\nHere:\n{"a":1,}\n```');
    expect(result?.value).toEqual({ a: 1 });
    expect(result!.repairs.length).toBeGreaterThan(1);
  });
});

describe('parseJsonLoosely — refuses to invent structure', () => {
  it('returns null for a truncated object rather than closing it', () => {
    // The model ran out of tokens mid-object. Closing the brace would fabricate
    // a complete value the model never produced.
    expect(parseJsonLoosely('{"name":"Alice Brand","positioning":{"usp":"Some')).toBeNull();
  });

  it('returns null for a truncated array', () => {
    expect(parseJsonLoosely('[{"a":1},{"b":')).toBeNull();
  });

  it('returns null for text containing no JSON at all', () => {
    expect(parseJsonLoosely('I cannot help with that request.')).toBeNull();
    expect(parseJsonLoosely('')).toBeNull();
  });

  it('does not guess at a missing value', () => {
    expect(parseJsonLoosely('{"a":}')).toBeNull();
    expect(parseJsonLoosely('{"a": 1, "b"}')).toBeNull();
  });
});

describe('extractBalancedJson — respects string literals', () => {
  it('is not fooled by braces inside a string', () => {
    // A naive indexOf/lastIndexOf slice truncates here.
    const text = 'prose {"tagline":"Style { curly } braces","x":1} more prose';
    const extracted = extractBalancedJson(text);
    expect(extracted).toBe('{"tagline":"Style { curly } braces","x":1}');
    expect(JSON.parse(extracted!)).toEqual({ tagline: 'Style { curly } braces', x: 1 });
  });

  it('handles escaped quotes', () => {
    const text = '{"quote":"she said \\"hello\\" loudly"}';
    expect(JSON.parse(extractBalancedJson(text)!)).toEqual({ quote: 'she said "hello" loudly' });
  });

  it('handles nested structures', () => {
    const text = 'x {"a":{"b":{"c":[1,{"d":2}]}}} y';
    expect(JSON.parse(extractBalancedJson(text)!)).toEqual({ a: { b: { c: [1, { d: 2 }] } } });
  });

  it('returns null when unbalanced', () => {
    expect(extractBalancedJson('{"a":{"b":1}')).toBeNull();
  });

  it('picks whichever of { or [ comes first', () => {
    expect(extractBalancedJson('text [1,2] more')).toBe('[1,2]');
  });
});

describe('removeTrailingCommas — does not touch string content', () => {
  it('preserves a comma inside a string', () => {
    const input = '{"list":"eggs, milk, bread"}';
    expect(removeTrailingCommas(input)).toBe(input);
  });

  it('preserves a comma-then-brace sequence inside a string', () => {
    const input = '{"weird":"ends with ,}"}';
    expect(JSON.parse(removeTrailingCommas(input))).toEqual({ weird: 'ends with ,}' });
  });

  it('removes the comma with whitespace before the closer', () => {
    expect(JSON.parse(removeTrailingCommas('{"a":1,\n  \n}'))).toEqual({ a: 1 });
  });
});

describe('stripJsonComments — does not touch string content', () => {
  it('preserves a URL inside a string', () => {
    const input = '{"url":"https://owbrand.ai/path"}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({ url: 'https://owbrand.ai/path' });
  });

  it('preserves what looks like a block comment inside a string', () => {
    const input = '{"note":"use /* this */ syntax"}';
    expect(JSON.parse(stripJsonComments(input))).toEqual({ note: 'use /* this */ syntax' });
  });
});

describe('stripCodeFence', () => {
  it('leaves unfenced text alone apart from trimming', () => {
    expect(stripCodeFence('  {"a":1}  ')).toBe('{"a":1}');
  });

  it('handles a javascript-tagged fence', () => {
    expect(stripCodeFence('```javascript\n{"a":1}\n```')).toBe('{"a":1}');
  });
});
