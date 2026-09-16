import { OWNER_PLACEHOLDER_NAME, occupantDisplayName } from './organizations.service';

/**
 * Имя человека в реферальной сети и в «Комиссиях» админки. Регистрация
 * организации пишет владельцу заглушку «Owner» — на живом стенде 16.09.2026
 * вся демо-сеть из независимых риэлторов называлась «Owner».
 */
describe('occupantDisplayName', () => {
  const realtor = { name: 'Нино Беридзе', type: 'independent_realtor' as const };
  const agency = { name: 'Агентство Batumi Home', type: 'agency' as const };

  it('настоящее имя в должности важнее всего', () => {
    expect(occupantDisplayName('Давид Церетели', agency)).toBe('Давид Церетели');
    expect(occupantDisplayName('  Анна  ', realtor)).toBe('Анна');
  });

  it('заглушка владельца — не имя: у независимого риэлтора берётся название организации', () => {
    expect(occupantDisplayName(OWNER_PLACEHOLDER_NAME, realtor)).toBe('Нино Беридзе');
    expect(occupantDisplayName(undefined, realtor)).toBe('Нино Беридзе');
  });

  it('у владельца агентства и без организации имени нет — решает вызывающий код', () => {
    expect(occupantDisplayName(OWNER_PLACEHOLDER_NAME, agency)).toBeNull();
    expect(occupantDisplayName(null, null)).toBeNull();
  });
});
