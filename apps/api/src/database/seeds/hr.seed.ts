import { DataSource, EntityManager } from 'typeorm';
import { BonusTier, EmploymentType, HrPolicyStatus, PayBasis } from '@multizoo/types';
import { BusinessUnit } from '../../app/modules/business-units/entities/business-unit.entity';
import { Department, Designation, Holiday } from '../../app/modules/hr/entities/org.entity';
import { Employee, SalaryRevision } from '../../app/modules/hr/entities/employee.entity';
import { HrPolicy, HrPolicyLeaveRule, LeaveType } from '../../app/modules/hr/entities/leave.entity';

/**
 * Module 4 starting data (docs/module-04-employees-attendance-leave.md):
 *
 * - Job titles exactly as the "Nov 2024 Salary Sheet ZOO" writes them, each
 *   with a starting bonus tier (Manager / Supervisor / Ticketer / Worker —
 *   the Bonus Calculator's tiers). Tiers are for the Phase 0 sign-off.
 * - Departments per unit.
 * - Leave types, and HR policy v1 with the Shops & Establishments Ordinance
 *   minimums from the architecture plan (Part 07 §03). Starting values for
 *   the leave-policy sign-off, not confirmed policy.
 * - Fixed-date public holidays. Moon-sighted festivals (both Eids, Ashura,
 *   Eid Milad-un-Nabi) are added by the Accountant once announced.
 * - Outside production only: a sample roster so attendance and leave can
 *   be demoed. Invented names — the real roster comes in with the
 *   historical import, not in source code.
 *
 * Idempotent: only ever adds what's missing.
 */

const T = BonusTier;
const DESIGNATIONS: [name: string, tier: BonusTier][] = [
  ["Operation's Officer", T.MANAGER],
  ['Supervisor', T.SUPERVISOR],
  ['JJ Supervisor', T.SUPERVISOR],
  ['MBF Supervisor', T.SUPERVISOR],
  ['GS1', T.SUPERVISOR],
  ['GS2', T.SUPERVISOR],
  ['Ticket Incharge', T.TICKETER],
  ['J J Cashier', T.TICKETER],
  ['Cafe Cashier', T.TICKETER],
  ['Zoo Worker', T.WORKER],
  ['ATI / GTI', T.WORKER],
  ["Lion's Handler", T.WORKER],
  ['DVM', T.WORKER],
  ['V Logger', T.WORKER],
  ['Office Boy', T.WORKER],
  ['Security Guard', T.WORKER],
  ['Gardener', T.WORKER],
  ['Electrician', T.WORKER],
  ['Driver', T.WORKER],
  ['Head Cook', T.WORKER],
  ['Cafe Cook', T.WORKER],
  ['Cook Helper', T.WORKER],
  ['MBF Worker', T.WORKER],
  ['Shop Assistant', T.WORKER],
  ['Ride Operator', T.WORKER],
];

const DEPARTMENTS: Record<string, string[]> = {
  ZOO: ['Animal Care', 'Ticketing', 'Security', 'Maintenance', 'Administration'],
  CAFE: ['Kitchen', 'Counter'],
  GIFT: ['Shop Floor'],
  JOYLAND: ['Rides', 'Ticketing'],
  PETS: ['Shop Floor'],
  MBF: ['Breeding'],
};

const LEAVE_TYPES = [
  { code: 'ANNUAL', name: 'Annual leave', isPaid: true, sortOrder: 10, description: 'After 12 months’ continuous service.' },
  { code: 'CASUAL', name: 'Casual leave', isPaid: true, sortOrder: 20, description: 'Short, unplanned absences; doesn’t carry forward.' },
  { code: 'SICK', name: 'Sick leave', isPaid: true, sortOrder: 30, description: 'Carries forward up to a cap.' },
  { code: 'UNPAID', name: 'Unpaid leave', isPaid: false, sortOrder: 90, description: 'Authorised absence without pay.' },
];

const REGULAR = [EmploymentType.PERMANENT, EmploymentType.CONTRACT];

/** Part 07 §03: 14 annual (after 12 months), 10 casual (max 3 at a stretch, no carry), 8 sick (carries to 16). */
const POLICY_V1 = [
  { code: 'ANNUAL', daysPerYear: '14', availableAfterMonths: 12, maxConsecutiveDays: null, carryForward: true, maxBalance: '28', encashable: true },
  { code: 'CASUAL', daysPerYear: '10', availableAfterMonths: 0, maxConsecutiveDays: 3, carryForward: false, maxBalance: null, encashable: false },
  { code: 'SICK', daysPerYear: '8', availableAfterMonths: 0, maxConsecutiveDays: null, carryForward: true, maxBalance: '16', encashable: false },
];

const FIXED_HOLIDAYS: [monthDay: string, name: string][] = [
  ['02-05', 'Kashmir Solidarity Day'],
  ['03-23', 'Pakistan Day'],
  ['05-01', 'Labour Day'],
  ['08-14', 'Independence Day'],
  ['11-09', 'Iqbal Day'],
  ['12-25', 'Quaid-e-Azam Day'],
];

/** Invented people, real shape: designations and salaries as the Nov 2024 sheet has them. */
const SAMPLE_ROSTER: {
  unit: string;
  dept: string;
  name: string;
  designation: string;
  salary: string;
  joined: string;
  off: number | null;
  type?: EmploymentType;
}[] = [
  { unit: 'ZOO', dept: 'Administration', name: 'Kamran Yousaf', designation: "Operation's Officer", salary: '66000', joined: '2019-03-01', off: 1 },
  { unit: 'ZOO', dept: 'Animal Care', name: 'Tariq Mehmood', designation: 'Supervisor', salary: '35000', joined: '2021-06-15', off: 2 },
  { unit: 'ZOO', dept: 'Animal Care', name: 'Naveed Akhtar', designation: "Lion's Handler", salary: '38500', joined: '2020-09-01', off: 3 },
  { unit: 'ZOO', dept: 'Animal Care', name: 'Faisal Rehman', designation: 'DVM', salary: '38500', joined: '2022-02-01', off: 4 },
  { unit: 'ZOO', dept: 'Animal Care', name: 'Imran Siddiqui', designation: 'Zoo Worker', salary: '23000', joined: '2023-04-10', off: 1 },
  { unit: 'ZOO', dept: 'Animal Care', name: 'Adnan Farooq', designation: 'Zoo Worker', salary: '27500', joined: '2021-11-01', off: 2 },
  { unit: 'ZOO', dept: 'Animal Care', name: 'Waqas Javed', designation: 'Zoo Worker', salary: '23000', joined: '2025-10-01', off: 3 },
  { unit: 'ZOO', dept: 'Animal Care', name: 'Sohail Anwar', designation: 'ATI / GTI', salary: '25000', joined: '2024-01-15', off: 4 },
  { unit: 'ZOO', dept: 'Ticketing', name: 'Rizwan Haider', designation: 'Ticket Incharge', salary: '33000', joined: '2020-05-01', off: 1 },
  { unit: 'ZOO', dept: 'Security', name: 'Asghar Ali', designation: 'Security Guard', salary: '32500', joined: '2022-08-01', off: 2 },
  { unit: 'ZOO', dept: 'Maintenance', name: 'Zubair Hussain', designation: 'Electrician', salary: '28000', joined: '2023-01-01', off: 3 },
  { unit: 'ZOO', dept: 'Maintenance', name: 'Nadeem Abbas', designation: 'Gardener', salary: '25000', joined: '2026-07-01', off: 4 },
  { unit: 'ZOO', dept: 'Administration', name: 'Arif Iqbal', designation: 'Driver', salary: '30000', joined: '2021-02-01', off: 1 },
  { unit: 'CAFE', dept: 'Kitchen', name: 'Shahid Latif', designation: 'Head Cook', salary: '30000', joined: '2020-12-01', off: 2 },
  { unit: 'CAFE', dept: 'Kitchen', name: 'Usman Ghani', designation: 'Cafe Cook', salary: '26000', joined: '2022-05-01', off: 3 },
  { unit: 'CAFE', dept: 'Kitchen', name: 'Bilal Aslam', designation: 'Cook Helper', salary: '23000', joined: '2025-03-01', off: 4 },
  { unit: 'CAFE', dept: 'Counter', name: 'Hamza Saleem', designation: 'Cafe Cashier', salary: '25000', joined: '2023-09-01', off: 1 },
  { unit: 'CAFE', dept: 'Counter', name: 'Ahsan Raza', designation: 'Supervisor', salary: '35000', joined: '2019-07-01', off: 2 },
  { unit: 'GIFT', dept: 'Shop Floor', name: 'Junaid Khalid', designation: 'JJ Supervisor', salary: '35000', joined: '2021-04-01', off: 3 },
  { unit: 'GIFT', dept: 'Shop Floor', name: 'Saad Nawaz', designation: 'J J Cashier', salary: '23000', joined: '2024-06-01', off: 4 },
  { unit: 'MBF', dept: 'Breeding', name: 'Irfan Shah', designation: 'MBF Supervisor', salary: '35000', joined: '2022-10-01', off: 1 },
  { unit: 'MBF', dept: 'Breeding', name: 'Aamir Sultan', designation: 'MBF Worker', salary: '27500', joined: '2023-12-01', off: 2, type: EmploymentType.CONTRACT },
  { unit: 'JOYLAND', dept: 'Rides', name: 'Fahad Mustafa', designation: 'Ride Operator', salary: '1000', joined: '2026-06-01', off: null, type: EmploymentType.DAILY_WAGE },
];

async function ensureDesignations(m: EntityManager) {
  let created = 0;
  for (const [name, bonusTier] of DESIGNATIONS) {
    if (await m.findOne(Designation, { where: { name }, withDeleted: true })) continue;
    await m.save(m.create(Designation, { name, bonusTier }));
    created++;
  }
  return created;
}

async function ensureDepartments(m: EntityManager) {
  let created = 0;
  for (const [code, names] of Object.entries(DEPARTMENTS)) {
    const unit = await m.findOne(BusinessUnit, { where: { code } });
    if (!unit) continue;
    for (const name of names) {
      if (await m.findOne(Department, { where: { businessUnitId: unit.id, name }, withDeleted: true })) continue;
      await m.save(m.create(Department, { businessUnitId: unit.id, name }));
      created++;
    }
  }
  return created;
}

async function ensureLeavePolicy(m: EntityManager) {
  let typesCreated = 0;
  for (const t of LEAVE_TYPES) {
    if (await m.findOne(LeaveType, { where: { code: t.code }, withDeleted: true })) continue;
    await m.save(m.create(LeaveType, t));
    typesCreated++;
  }
  if (await m.count(HrPolicy)) return { typesCreated, policyCreated: false };
  const types = await m.find(LeaveType);
  await m.save(
    m.create(HrPolicy, {
      version: 1,
      effectiveFrom: '2000-01-01',
      status: HrPolicyStatus.ACTIVE,
      attendanceBackdateDays: 7,
      note:
        'Seeded with the Shops & Establishments Ordinance minimums (architecture plan Part 07 §03) — starting values for the Phase 0 leave-policy sign-off. Annual leave carry-forward (up to 28 days) is to be confirmed.',
      leaveRules: POLICY_V1.map((r) =>
        m.create(HrPolicyLeaveRule, {
          leaveTypeId: types.find((t) => t.code === r.code)?.id,
          daysPerYear: r.daysPerYear,
          availableAfterMonths: r.availableAfterMonths,
          maxConsecutiveDays: r.maxConsecutiveDays,
          carryForward: r.carryForward,
          maxBalance: r.maxBalance,
          encashable: r.encashable,
          employmentTypes: REGULAR,
        }),
      ),
    }),
  );
  return { typesCreated, policyCreated: true };
}

async function ensureHolidays(m: EntityManager) {
  let created = 0;
  for (const year of [2026, 2027]) {
    for (const [md, name] of FIXED_HOLIDAYS) {
      const date = `${year}-${md}`;
      const existing = await m
        .createQueryBuilder(Holiday, 'h')
        .where('h.date = :date AND h.businessUnitId IS NULL', { date })
        .getOne();
      if (existing) continue;
      await m.save(m.create(Holiday, { date, name, businessUnitId: null }));
      created++;
    }
  }
  return created;
}

async function ensureSampleRoster(m: EntityManager) {
  if (await m.count(Employee, { withDeleted: true })) return 0;
  const designations = await m.find(Designation);
  let n = 0;
  for (const s of SAMPLE_ROSTER) {
    const unit = await m.findOne(BusinessUnit, { where: { code: s.unit } });
    const designation = designations.find((d) => d.name === s.designation);
    if (!unit || !designation) continue;
    const dept = await m.findOne(Department, { where: { businessUnitId: unit.id, name: s.dept } });
    n++;
    const employee = await m.save(
      m.create(Employee, {
        employeeCode: `E-${String(n).padStart(4, '0')}`,
        fullName: s.name,
        businessUnitId: unit.id,
        departmentId: dept?.id ?? null,
        designationId: designation.id,
        employmentType: s.type ?? EmploymentType.PERMANENT,
        joinDate: s.joined,
        weeklyOffDay: s.off,
        notes: 'Sample record for the Phase 3 demo — not a real employee. Delete before go-live.',
      }),
    );
    await m.save(
      m.create(SalaryRevision, {
        employeeId: employee.id,
        effectiveFrom: s.joined,
        baseSalary: s.salary,
        payBasis: s.type === EmploymentType.DAILY_WAGE ? PayBasis.DAILY : PayBasis.MONTHLY,
        reason: 'Starting salary',
      }),
    );
  }
  return n;
}

export async function seedHr(dataSource: DataSource): Promise<void> {
  await dataSource.transaction(async (m) => {
    console.log(`Designations: ${await ensureDesignations(m)} created`);
    console.log(`Departments: ${await ensureDepartments(m)} created`);
    const { typesCreated, policyCreated } = await ensureLeavePolicy(m);
    console.log(`Leave types: ${typesCreated} created; HR policy v1 ${policyCreated ? 'created' : 'already present'}`);
    console.log(`Holidays: ${await ensureHolidays(m)} created`);
    if (process.env.NODE_ENV === 'production' || process.env.SEED_SAMPLE_EMPLOYEES === 'false') {
      console.log('Sample employees: skipped');
    } else {
      console.log(`Sample employees: ${await ensureSampleRoster(m)} created`);
    }
  });
}
