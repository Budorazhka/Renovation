import { DEFAULT_ROLE_GRANTS } from './default-role-grants';
import type { FixedRole } from './schemas/position.schema';

const ALL_FIXED_ROLES: FixedRole[] = ['owner', 'director', 'rop', 'manager', 'administrator', 'marketer', 'developer'];

/**
 * Security review 31.08.2026: GET /team-users и POST /team-users/ensure-team
 * теперь требуют position.read (team.controller.ts) — без записи в
 * DEFAULT_ROLE_GRANTS для КАЖДОЙ FixedRole ни одна вновь созданная Position
 * этой роли не смогла бы увидеть список своей же команды (PolicyEvaluatorService
 * deny-by-default). Этот тест — regression guard: пропущенная роль здесь
 * молча ломает "Команда" для всех новых Position этой роли, обнаруживается
 * только вручную в UI, не typecheck'ом.
 */
describe('DEFAULT_ROLE_GRANTS', () => {
  it.each(ALL_FIXED_ROLES)('роль %s включает position.read (scope organization)', (role) => {
    expect(DEFAULT_ROLE_GRANTS[role]).toContainEqual({
      resource: 'position',
      action: 'read',
      scope: 'organization',
    });
  });

  /**
   * Сверка permission-matrix.md разд.1.1–1.6 vs код (14.09.2026, открытый
   * пункт с 11.09.2026): D-07 требует у `developer` "тот же набор, что у
   * agency owner" — client.reassign (PATCH /deals/:id/reassign) был
   * пропущен при первом заведении роли. Регрессия на будущее: если кто-то
   * снова добавит owner organization-wide право без синхронизации с
   * developer, этот тест должен упасть.
   */
  it.each(['owner', 'director', 'rop', 'developer'] as const)(
    'роль %s включает client.reassign (scope organization)',
    (role) => {
      expect(DEFAULT_ROLE_GRANTS[role]).toContainEqual({
        resource: 'client',
        action: 'reassign',
        scope: 'organization',
      });
    },
  );

  it.each(['manager', 'administrator', 'marketer'] as const)(
    'роль %s НЕ включает client.reassign (permission-matrix.md разд.1.1)',
    (role) => {
      expect(DEFAULT_ROLE_GRANTS[role]).not.toContainEqual(
        expect.objectContaining({ resource: 'client', action: 'reassign' }),
      );
    },
  );
});
