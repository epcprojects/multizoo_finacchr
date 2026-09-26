import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { environment } from '../../environments/environment';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { BusinessUnitsModule } from './modules/business-units/business-units.module';
import { AccountsModule } from './modules/accounts/accounts.module';
import { JournalModule } from './modules/journal/journal.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { AllocationModule } from './modules/allocation/allocation.module';
import { HrModule } from './modules/hr/hr.module';
import { PayrollModule } from './modules/payroll/payroll.module';
import { LoansModule } from './modules/loans/loans.module';
import { UtilitiesModule } from './modules/utilities/utilities.module';
import { CostCentresModule } from './modules/cost-centres/cost-centres.module';
import { SalesModule } from './modules/sales/sales.module';
import { CapexModule } from './modules/capex/capex.module';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { PermissionsGuard } from '../common/guards/permissions.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true, // .env is loaded into process.env by the Nx executor
      load: [environment],
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const postgresConfig = configService.get('postgres');
        return { ...postgresConfig };
      },
    }),
    AuthModule,
    UsersModule,
    RolesModule,
    BusinessUnitsModule,
    AccountsModule,
    JournalModule,
    LedgerModule,
    AllocationModule,
    HrModule,
    PayrollModule,
    LoansModule,
    UtilitiesModule,
    CostCentresModule,
    SalesModule,
    CapexModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // Every route requires a valid JWT unless marked @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // Then, for routes marked @RequirePermission(), the claim/role check.
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
