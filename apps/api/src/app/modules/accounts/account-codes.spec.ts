import { AccountClassUnitRule, AccountType } from '@multizoo/types';
import { buildCode, nextNumber, parseNumber, relabelUnitCode, validatePattern } from './account-codes';
import { classRuleViolation, keyFromName } from './account-classes.service';

describe('code patterns', () => {
  it('builds and parses the default patterns', () => {
    expect(buildCode('{UNIT}-{NUM}', 1100, 'CAFE')).toBe('CAFE-1100');
    expect(buildCode('{NUM}', 5110)).toBe('5110');
    expect(parseNumber('{UNIT}-{NUM}', 'CAFE-1510', 'CAFE')).toBe(1510);
    expect(parseNumber('{NUM}', '5110')).toBe(5110);
  });

  it('supports other layouts, e.g. number first', () => {
    expect(buildCode('{NUM}.{UNIT}', 1200, 'ZOO')).toBe('1200.ZOO');
    expect(parseNumber('{NUM}.{UNIT}', '1200.ZOO', 'ZOO')).toBe(1200);
    expect(buildCode('GL-{NUM}', 4100)).toBe('GL-4100');
    expect(parseNumber('GL-{NUM}', 'GL-4100')).toBe(4100);
  });

  it("ignores codes from another unit or another pattern", () => {
    expect(parseNumber('{UNIT}-{NUM}', 'ZOO-1100', 'CAFE')).toBeNull();
    expect(parseNumber('{NUM}', 'CAFE-1100')).toBeNull();
    // A unit code with regex characters must be matched literally.
    expect(parseNumber('{UNIT}-{NUM}', 'A.B-1100', 'A.B')).toBe(1100);
    expect(parseNumber('{UNIT}-{NUM}', 'AXB-1100', 'A.B')).toBeNull();
  });

  it('validates patterns', () => {
    expect(validatePattern('{UNIT}-{NUM}', { requireUnit: true })).toBeNull();
    expect(validatePattern('{NUM}', { requireUnit: false })).toBeNull();
    expect(validatePattern('{NUM}', { requireUnit: true })).toMatch(/must include \{UNIT\}/);
    expect(validatePattern('{UNIT}', { requireUnit: true })).toMatch(/\{NUM\} exactly once/);
    expect(validatePattern('{NUM}-{NUM}', { requireUnit: false })).toMatch(/exactly once/);
    expect(validatePattern('{NUM} x', { requireUnit: false })).toMatch(/only A–Z/);
  });
});

describe('relabelUnitCode', () => {
  it('swaps the unit segment in any layout', () => {
    expect(relabelUnitCode('JOYLAND-1100', 'JOYLAND', 'JL')).toBe('JL-1100');
    expect(relabelUnitCode('1100.JOYLAND', 'JOYLAND', 'JL')).toBe('1100.JL');
    expect(relabelUnitCode('GL/JOYLAND/1510', 'JOYLAND', 'JL')).toBe('GL/JL/1510');
  });

  it('leaves codes that only contain the old code as part of a word', () => {
    expect(relabelUnitCode('CAFETERIA-1100', 'CAFE', 'PC')).toBe('CAFETERIA-1100');
    expect(relabelUnitCode('5110', 'CAFE', 'PC')).toBe('5110');
  });
});

describe('nextNumber', () => {
  it('starts an empty range at its first number', () => {
    expect(nextNumber([], 1500, 1999, 10)).toBe(1500);
  });

  it('steps past the highest used number, leaving gaps', () => {
    expect(nextNumber([1500, 1510, 1520], 1500, 1999, 10)).toBe(1530);
    expect(nextNumber([5110, 5120, 5160], 5101, 5199, 10)).toBe(5170);
  });

  it('only counts numbers inside the range', () => {
    expect(nextNumber([1100, 1200, 9000], 1500, 1999, 10)).toBe(1500);
  });

  it('falls back to +1 near the end of the range, and never reuses a number', () => {
    expect(nextNumber([1995], 1500, 1999, 10)).toBe(1996);
    expect(nextNumber([1995, 1996, 1997, 1998, 1999], 1500, 1999, 10)).toBeNull();
  });
});

describe('class rules', () => {
  const base = {
    type: AccountType.ASSET,
    unitRule: AccountClassUnitRule.UNIT_REQUIRED,
    codeStart: 1100,
    codeEnd: 1199,
    isLiquid: true,
    isReserve: false,
    isReconcilable: true,
    provisionForNewUnits: true,
  };

  it('accepts the seeded Cash class', () => {
    expect(classRuleViolation(base)).toBeNull();
  });

  it.each([
    ['backwards range', { codeStart: 1200, codeEnd: 1100 }],
    ['liquid and reserve', { isReserve: true }],
    ['liquid liability', { type: AccountType.LIABILITY }],
    ['group-wide cash', { unitRule: AccountClassUnitRule.EITHER }],
    ['reconcilable expense', { type: AccountType.EXPENSE, isLiquid: false, provisionForNewUnits: false }],
    ['auto-created group-only class', { isLiquid: false, isReconcilable: false, unitRule: AccountClassUnitRule.GROUP_ONLY }],
  ])('rejects %s', (_label, patch) => {
    expect(classRuleViolation({ ...base, ...patch })).not.toBeNull();
  });

  it('derives a stable key from the name', () => {
    expect(keyFromName('Fixed Asset')).toBe('FIXED_ASSET');
    expect(keyFromName('  Loan / Payable ')).toBe('LOAN_PAYABLE');
  });
});
