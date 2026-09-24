import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BusinessUnitType } from './entities/business-unit-type.entity';
import { BusinessUnit } from './entities/business-unit.entity';
import type { AuthenticatedUser } from '../users/users.service';
import { keyFromName } from '../accounts/account-classes.service';
import {
  CreateBusinessUnitTypeDto,
  UpdateBusinessUnitTypeDto,
} from './dto/business-unit.dto';

/** The configurable list behind the "Type of business" dropdown. */
@Injectable()
export class BusinessUnitTypesService {
  constructor(
    @InjectRepository(BusinessUnitType)
    private readonly typeRepo: Repository<BusinessUnitType>,

    @InjectRepository(BusinessUnit)
    private readonly unitRepo: Repository<BusinessUnit>,
  ) {}

  async list(includeInactive = false) {
    const types = await this.typeRepo.find({
      where: includeInactive ? {} : { isActive: true },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    const counts = await this.unitRepo
      .createQueryBuilder('u')
      .select('u.typeId', 'typeId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('u.typeId')
      .getRawMany<{ typeId: string; count: string }>();
    const countOf = new Map(counts.map((c) => [c.typeId, Number(c.count)]));
    return types.map((t) => ({ ...this.shape(t), unitCount: countOf.get(t.id) ?? 0 }));
  }

  shape(t: BusinessUnitType) {
    return {
      id: t.id,
      key: t.key,
      name: t.name,
      description: t.description,
      isHolding: t.isHolding,
      sortOrder: t.sortOrder,
      isSystem: t.isSystem,
      isActive: t.isActive,
    };
  }

  /** An active type, for assigning to a unit. */
  async activeType(id: string): Promise<BusinessUnitType> {
    const t = await this.typeRepo.findOne({ where: { id } });
    if (!t || !t.isActive) throw new BadRequestException('Type of business not found or inactive');
    return t;
  }

  async create(dto: CreateBusinessUnitTypeDto, user: AuthenticatedUser) {
    await this.assertNameFree(dto.name);
    let key = keyFromName(dto.name);
    for (let n = 2; await this.typeRepo.findOne({ where: { key }, withDeleted: true }); n++) {
      key = `${keyFromName(dto.name).slice(0, 34)}_${n}`;
    }
    const saved = await this.typeRepo.save(
      this.typeRepo.create({
        key,
        name: dto.name.trim(),
        description: dto.description?.trim() || null,
        isHolding: dto.isHolding ?? false,
        sortOrder: dto.sortOrder ?? 100,
        isSystem: false,
        createdBy: user.id,
      }),
    );
    return { ...this.shape(saved), unitCount: 0 };
  }

  async update(id: string, dto: UpdateBusinessUnitTypeDto, user: AuthenticatedUser) {
    const t = await this.typeRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Type of business not found');
    if (dto.name && dto.name.trim().toUpperCase() !== t.name.toUpperCase()) await this.assertNameFree(dto.name, id);

    // Deactivating only hides it from new units; units already using it keep it.
    if (dto.name !== undefined) t.name = dto.name.trim();
    if (dto.description !== undefined) t.description = dto.description.trim() || null;
    if (dto.isHolding !== undefined) t.isHolding = dto.isHolding;
    if (dto.sortOrder !== undefined) t.sortOrder = dto.sortOrder;
    if (dto.isActive !== undefined) t.isActive = dto.isActive;
    t.updatedBy = user.id;
    const saved = await this.typeRepo.save(t);
    const unitCount = await this.unitRepo.count({ where: { typeId: id } });
    return { ...this.shape(saved), unitCount };
  }

  private async assertNameFree(name: string, exceptId?: string) {
    const qb = this.typeRepo.createQueryBuilder('t').where('UPPER(t.name) = UPPER(:name)', { name: name.trim() });
    if (exceptId) qb.andWhere('t.id != :exceptId', { exceptId });
    const clash = await qb.withDeleted().getOne();
    if (clash) throw new ConflictException(`A type named "${clash.name}" already exists.`);
  }
}
