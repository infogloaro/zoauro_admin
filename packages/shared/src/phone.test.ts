import { describe, expect, it } from 'vitest';
import { normaliseIndianMobile, phoneHint } from './index';

describe('Indian mobile normalisation (doc 52 section 11: phone normalisation table)', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['+91-98765-43210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['0091 98765 43210', '+919876543210'],
    ['(+91) 6000000000', '+916000000000'], // brackets are separators, like spaces
    ['+91 6000000000', '+916000000000'],
    ['5876543210', null], // mobile numbers start 6-9
    ['987654321', null],
    ['98765432100', null],
    ['+1 4155552671', null],
    ['abcdefghij', null],
    ['', null],
  ])('%j -> %j', (input, want) => {
    expect(normaliseIndianMobile(input)).toBe(want);
  });

  it('hint keeps the country code and the last three digits only', () => {
    expect(phoneHint('+919876543210')).toBe('+91•••••••210');
  });
});
