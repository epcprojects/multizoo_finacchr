import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../../app/modules/users/entities/user.entity';
import { UserRole } from '../../app/modules/users/entities/user.roles.entity';
import { Role } from '../../app/modules/roles/entities/role.entity';
import { RoleClaim } from '../../app/modules/roles/entities/role.claim.entity';
import { seedRoles } from './roles.seed';
import { seedSuperAdmin } from './super-admin.seed';

async function main() {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 5432,
    username: process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    entities: [User, UserRole, Role, RoleClaim],
    synchronize: false,
  });

  await dataSource.initialize();
  console.log(`Connected to ${process.env.DB_DATABASE}@${process.env.DB_HOST}`);

  await seedRoles(dataSource);
  await seedSuperAdmin(dataSource);

  await dataSource.destroy();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
