import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../../app/modules/users/entities/user.entity';
import { UserRole } from '../../app/modules/users/entities/user.roles.entity';
import { Role } from '../../app/modules/roles/entities/role.entity';
import { RoleClaim } from '../../app/modules/roles/entities/role.claim.entity';
import { BusinessUnit } from '../../app/modules/business-units/entities/business-unit.entity';
import { BusinessUnitType } from '../../app/modules/business-units/entities/business-unit-type.entity';
import { Account } from '../../app/modules/accounts/entities/account.entity';
import { AccountClass } from '../../app/modules/accounts/entities/account-class.entity';
import { ChartSettings } from '../../app/modules/accounts/entities/chart-settings.entity';
import { UserBusinessUnit } from '../../app/modules/users/entities/user.business-unit.entity';
import { JournalEntry } from '../../app/modules/journal/entities/journal-entry.entity';
import { JournalLine } from '../../app/modules/journal/entities/journal-line.entity';
import { CashReconciliation } from '../../app/modules/ledger/entities/cash-reconciliation.entity';
import { seedRoles } from './roles.seed';
import { seedLedger } from './ledger.seed';
import { seedSuperAdmin } from './super-admin.seed';
import { seedAllocation } from './allocation.seed';
import { Partner } from '../../app/modules/allocation/entities/partner.entity';
import { AllocationLine, AllocationRule, AllocationTranche } from '../../app/modules/allocation/entities/allocation-rule.entity';
import { AllocationRun } from '../../app/modules/allocation/entities/allocation-run.entity';
import { Department, Designation, Holiday } from '../../app/modules/hr/entities/org.entity';
import { Employee, SalaryRevision } from '../../app/modules/hr/entities/employee.entity';
import {
  HrPolicy,
  HrPolicyLeaveRule,
  LeaveAdjustment,
  LeaveRequest,
  LeaveType,
} from '../../app/modules/hr/entities/leave.entity';
import { AttendanceRecord, DisciplinaryRecord } from '../../app/modules/hr/entities/attendance.entity';
import { seedHr } from './hr.seed';
import { seedPayroll } from './payroll.seed';
import { PayrollAdjustment, PayrollPolicy, PayrollRun, Payslip } from '../../app/modules/payroll/entities/payroll.entity';
import { AdvanceRecovery, SalaryAdvance } from '../../app/modules/payroll/entities/advance.entity';
import { BonusPool, BonusPoolMember } from '../../app/modules/payroll/entities/bonus.entity';
import { FinalSettlement } from '../../app/modules/payroll/entities/settlement.entity';
import { Counterparty, Loan, LoanMovement } from '../../app/modules/loans/entities/loan.entity';
import { SubMeter, UtilityBill, UtilityConnection } from '../../app/modules/utilities/entities/utility.entity';
import { CostCentre } from '../../app/modules/cost-centres/entities/cost-centre.entity';
import { seedLoansUtilities } from './loans-utilities.seed';
import { SalesDay, SalesEvent, SalesItem, SalesLine } from '../../app/modules/sales/entities/sales.entity';
import { Campaign, CampaignEntry, CapexItem } from '../../app/modules/capex/entities/capex.entity';
import { seedSalesCapex } from './sales-capex.seed';

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [
      User,
      UserRole,
      Role,
      RoleClaim,
      BusinessUnit,
      BusinessUnitType,
      Account,
      AccountClass,
      ChartSettings,
      UserBusinessUnit,
      JournalEntry,
      JournalLine,
      CashReconciliation,
      Partner,
      AllocationRule,
      AllocationTranche,
      AllocationLine,
      AllocationRun,
      Department,
      Designation,
      Holiday,
      Employee,
      SalaryRevision,
      LeaveType,
      HrPolicy,
      HrPolicyLeaveRule,
      LeaveRequest,
      LeaveAdjustment,
      AttendanceRecord,
      DisciplinaryRecord,
      PayrollPolicy,
      PayrollRun,
      PayrollAdjustment,
      Payslip,
      SalaryAdvance,
      AdvanceRecovery,
      BonusPool,
      BonusPoolMember,
      FinalSettlement,
      Counterparty,
      Loan,
      LoanMovement,
      UtilityConnection,
      SubMeter,
      UtilityBill,
      CostCentre,
      SalesItem,
      SalesDay,
      SalesLine,
      SalesEvent,
      CapexItem,
      Campaign,
      CampaignEntry,
    ],
    synchronize: false,
  });

  await dataSource.initialize();
  console.log(`Connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}`);

  await seedRoles(dataSource);
  await seedSuperAdmin(dataSource);
  await seedLedger(dataSource);
  await seedAllocation(dataSource);
  await seedHr(dataSource);
  await seedPayroll(dataSource);
  await seedLoansUtilities(dataSource);
  await seedSalesCapex(dataSource);

  await dataSource.destroy();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
