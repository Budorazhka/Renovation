import {
  CURATOR_RATE_PERCENT,
  INVITE_CODE_LENGTH,
  curatorAccrualAmount,
  generateInviteCode,
  isCompanyCompatible,
  normalizeInviteCode,
  teamSizeStatus,
} from './referral-rules';

describe('правила реферальной сети', () => {
  it('размер команды подсказывает, а не запрещает: меньше 5 — набор, 5–20 — норма, больше 20 — пора собирать новую', () => {
    expect(teamSizeStatus(0)).toBe('recruiting');
    expect(teamSizeStatus(4)).toBe('recruiting');
    expect(teamSizeStatus(5)).toBe('healthy');
    expect(teamSizeStatus(20)).toBe('healthy');
    expect(teamSizeStatus(21)).toBe('time_to_split');
  });

  it('куратору 7% от фактической комиссии, в валюте сделки, до цента', () => {
    expect(CURATOR_RATE_PERCENT).toBe(7);
    expect(curatorAccrualAmount({ amountMinorUnits: 300_000, currency: 'USD' })).toEqual({
      amountMinorUnits: 21_000,
      currency: 'USD',
    });
    // 3 000,05 $ × 7% = 210,0035 $ → 210,00 $
    expect(curatorAccrualAmount({ amountMinorUnits: 300_005, currency: 'GEL' })).toEqual({
      amountMinorUnits: 21_000,
      currency: 'GEL',
    });
    // 0,08 $ × 7% = 0,0056 $ → 0,01 $
    expect(curatorAccrualAmount({ amountMinorUnits: 8, currency: 'USD' }).amountMinorUnits).toBe(1);
  });

  it('сохранённый в начислении процент не зависит от текущего правила', () => {
    expect(curatorAccrualAmount({ amountMinorUnits: 100_000, currency: 'USD' }, 5).amountMinorUnits).toBe(5_000);
  });

  it('код приглашения читается без путаницы символов и сравнивается без учёта регистра', () => {
    const code = generateInviteCode();
    expect(code).toHaveLength(INVITE_CODE_LENGTH);
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]+$/);
    expect(normalizeInviteCode(`  ${code.toLowerCase()} `)).toBe(code);
  });

  it('сотрудник агентства не входит в команду куратора из другой компании', () => {
    const agencyA = { organizationId: 'org-a', organizationType: 'agency' };
    const agencyB = { organizationId: 'org-b', organizationType: 'agency' };
    const independent = { organizationId: 'org-ind', organizationType: 'independent_realtor' };
    const nobody = { organizationId: null, organizationType: null };

    expect(isCompanyCompatible(agencyA, agencyA)).toBe(true);
    expect(isCompanyCompatible(agencyA, agencyB)).toBe(false);
    expect(isCompanyCompatible(agencyA, independent)).toBe(false);
    expect(isCompanyCompatible(independent, agencyB)).toBe(true);
    expect(isCompanyCompatible(nobody, agencyB)).toBe(true);
  });
});
