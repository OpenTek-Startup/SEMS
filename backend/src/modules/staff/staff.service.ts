import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client';
import { AuditService } from '../../core/audit/audit.service';
import { normalizeEmail } from '../../core/auth/auth-rules';
import type { AuthContext } from '../../core/auth/auth.types';
import { currentTenantId } from '../../core/tenancy/tenant-context';
import { TenantPrismaService } from '../../core/tenancy/tenant-prisma.service';
import { parseDay } from '../academic/academic-rules';
import type { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import {
  changedFields,
  cleanText,
  filterStaff,
  type LinkedAccount,
  nextStaffNumber,
  normalizePhone,
  normalizeStaffNumber,
  type Problem,
  type StaffFilter,
  type StaffRow,
  type StaffView,
  toStaffView,
} from './staff-rules';

const STAFF_SELECT = {
  id: true,
  staffNumber: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  position: true,
  category: true,
  status: true,
  hireDate: true,
  userId: true,
} satisfies Prisma.StaffMemberSelect;

const ACCOUNT_SELECT = { id: true, email: true, status: true, firstName: true, lastName: true } satisfies Prisma.UserSelect;

/** A user account that can be linked to a staff record (not linked yet). */
export interface LinkableAccount {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

type Status = 400 | 404 | 409;

function fail(status: Status, problem: Problem): HttpException {
  if (status === 404) return new NotFoundException(problem);
  if (status === 409) return new ConflictException(problem);
  return new BadRequestException(problem);
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

/** The editable fields of a staff record, after cleaning. */
interface StaffFields {
  staffNumber: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  position: string;
  category: 'teaching' | 'non_teaching';
  hireDate: Date | null;
}

/**
 * Staff records of a school (module "staff"): teaching and non-teaching staff,
 * each optionally linked to the user account they sign in with.
 *
 * Everything goes through the school-scoped client: an id from another
 * school is "not found". Staff are never deleted, they become inactive,
 * so later records (assignments, registers, marks) keep pointing at them.
 */
@Injectable()
export class StaffService {
  constructor(
    private readonly tdb: TenantPrismaService,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.tdb.db;
  }

  // ------------------------------------------------------------- reads

  async list(filter: StaffFilter): Promise<StaffView[]> {
    this.requireSchool();
    const rows = await this.db.staffMember.findMany({ select: STAFF_SELECT });
    const accounts = await this.accountsOf(rows);
    return filterStaff(
      rows.map((r) => toStaffView(r, accounts)),
      filter,
    );
  }

  async get(id: string): Promise<StaffView> {
    this.requireSchool();
    const row = await this.find(id);
    return toStaffView(row, await this.accountsOf([row]));
  }

  /** Active user accounts of the school that no staff record uses yet. */
  async linkableAccounts(): Promise<LinkableAccount[]> {
    this.requireSchool();
    const [users, linked] = await Promise.all([
      this.db.user.findMany({ where: { status: 'active' }, select: ACCOUNT_SELECT }),
      this.db.staffMember.findMany({ where: { userId: { not: null } }, select: { userId: true } }),
    ]);
    const taken = new Set(linked.map((l) => l.userId));
    return users
      .filter((u) => !taken.has(u.id))
      .map((u) => ({ id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName }))
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' }) ||
          a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' }),
      );
  }

  // ------------------------------------------------------------ writes

  async create(actor: AuthContext, dto: CreateStaffDto, ip: string | null): Promise<StaffView> {
    const tenantId = this.requireSchool();
    const generated = dto.staffNumber === undefined || dto.staffNumber.trim() === '';
    const fields: StaffFields = {
      staffNumber: generated ? '' : this.staffNumber(dto.staffNumber!),
      firstName: cleanText(dto.firstName),
      lastName: cleanText(dto.lastName),
      email: this.email(dto.email),
      phone: this.phone(dto.phone),
      position: cleanText(dto.position),
      category: dto.category ?? 'teaching',
      hireDate: this.hireDate(dto.hireDate),
    };
    const userId = dto.userId ?? null;
    if (userId) await this.assertLinkable(userId, null);

    // A generated number can collide with someone saving at the same moment: try again once.
    let created: { id: string } | undefined;
    for (let attempt = 0; attempt < 2 && !created; attempt++) {
      const existing = await this.db.staffMember.findMany({ select: { id: true, staffNumber: true } });
      if (generated) {
        fields.staffNumber = nextStaffNumber(existing.map((e) => e.staffNumber));
      } else if (existing.some((e) => e.staffNumber === fields.staffNumber)) {
        throw this.numberTaken(fields.staffNumber);
      }
      try {
        created = await this.db.staffMember.create({ data: { tenantId, ...fields, userId }, select: { id: true } });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        if (!generated || attempt === 1) throw this.numberTaken(fields.staffNumber);
      }
    }

    await this.audit.record({
      action: 'staff.created',
      tenantId,
      actorUserId: actor.userId,
      entity: 'staff',
      entityId: created!.id,
      detail: { staffNumber: fields.staffNumber, name: `${fields.lastName} ${fields.firstName}`, userId },
      ipAddress: ip,
    });
    return this.get(created!.id);
  }

  async update(actor: AuthContext, id: string, dto: UpdateStaffDto, ip: string | null): Promise<StaffView> {
    const tenantId = this.requireSchool();
    const row = await this.find(id);
    const before: StaffFields = {
      staffNumber: row.staffNumber,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      position: row.position,
      category: row.category as StaffFields['category'],
      hireDate: row.hireDate,
    };
    const after: StaffFields = {
      staffNumber: dto.staffNumber !== undefined ? this.staffNumber(dto.staffNumber) : before.staffNumber,
      firstName: dto.firstName !== undefined ? cleanText(dto.firstName) : before.firstName,
      lastName: dto.lastName !== undefined ? cleanText(dto.lastName) : before.lastName,
      email: dto.email !== undefined ? this.email(dto.email) : before.email,
      phone: dto.phone !== undefined ? this.phone(dto.phone) : before.phone,
      position: dto.position !== undefined ? cleanText(dto.position) : before.position,
      category: dto.category ?? before.category,
      hireDate: dto.hireDate !== undefined ? this.hireDate(dto.hireDate) : before.hireDate,
    };

    const changed = changedFields(before, after);
    if (changed.length === 0) return this.get(id);

    if (after.staffNumber !== before.staffNumber) {
      const clash = await this.db.staffMember.findFirst({
        where: { staffNumber: after.staffNumber, id: { not: id } },
        select: { id: true },
      });
      if (clash) throw this.numberTaken(after.staffNumber);
    }

    try {
      await this.db.staffMember.update({ where: { id }, data: after });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.numberTaken(after.staffNumber);
      throw err;
    }

    await this.audit.record({
      action: 'staff.updated',
      tenantId,
      actorUserId: actor.userId,
      entity: 'staff',
      entityId: id,
      detail: { changed },
      ipAddress: ip,
    });
    return this.get(id);
  }

  /** inactive: the person has left; the record and its history stay. */
  async setStatus(actor: AuthContext, id: string, status: 'active' | 'inactive', ip: string | null): Promise<StaffView> {
    const tenantId = this.requireSchool();
    const row = await this.find(id);
    if (row.status === status) return this.get(id);

    await this.db.staffMember.update({ where: { id }, data: { status } });
    await this.audit.record({
      action: status === 'inactive' ? 'staff.deactivated' : 'staff.reactivated',
      tenantId,
      actorUserId: actor.userId,
      entity: 'staff',
      entityId: id,
      detail: { staffNumber: row.staffNumber },
      ipAddress: ip,
    });
    return this.get(id);
  }

  /** Links the record to a user account of the school, or unlinks it (null). */
  async linkAccount(actor: AuthContext, id: string, userId: string | null, ip: string | null): Promise<StaffView> {
    const tenantId = this.requireSchool();
    const row = await this.find(id);
    if (row.userId === userId) return this.get(id);
    if (userId) await this.assertLinkable(userId, id);

    try {
      await this.db.staffMember.update({ where: { id }, data: { userId } });
    } catch (err) {
      if (isUniqueViolation(err)) throw this.accountTaken();
      throw err;
    }
    await this.audit.record({
      action: userId ? 'staff.account.linked' : 'staff.account.unlinked',
      tenantId,
      actorUserId: actor.userId,
      entity: 'staff',
      entityId: id,
      detail: { userId: userId ?? row.userId },
      ipAddress: ip,
    });
    return this.get(id);
  }

  // ----------------------------------------------------------- helpers

  private async find(id: string): Promise<StaffRow> {
    const row = await this.db.staffMember.findFirst({ where: { id }, select: STAFF_SELECT });
    if (!row) throw fail(404, { code: 'STAFF_NOT_FOUND', message: 'This staff member does not exist in your school.' });
    return row;
  }

  private async accountsOf(rows: readonly { userId: string | null }[]): Promise<Map<string, LinkedAccount>> {
    const ids = [...new Set(rows.map((r) => r.userId).filter((u): u is string => !!u))];
    if (ids.length === 0) return new Map();
    const users = await this.db.user.findMany({ where: { id: { in: ids } }, select: ACCOUNT_SELECT });
    return new Map(users.map((u) => [u.id, { id: u.id, email: u.email, status: u.status }]));
  }

  /** The account must belong to this school and not be linked to another staff record. */
  private async assertLinkable(userId: string, staffId: string | null): Promise<void> {
    const user = await this.db.user.findFirst({ where: { id: userId }, select: { id: true } });
    if (!user) throw fail(400, { code: 'USER_NOT_FOUND', message: 'This user account does not exist in your school.' });
    const other = await this.db.staffMember.findFirst({
      where: staffId ? { userId, id: { not: staffId } } : { userId },
      select: { id: true },
    });
    if (other) throw this.accountTaken();
  }

  private staffNumber(value: string): string {
    const n = normalizeStaffNumber(value);
    if (!n) {
      throw fail(400, {
        code: 'STAFF_NUMBER_INVALID',
        message: 'A staff number has 2 to 20 letters, digits, "-" or "/", e.g. STF-0007.',
      });
    }
    return n;
  }

  private email(value: string | null | undefined): string | null {
    if (value === undefined || value === null || value.trim() === '') return null;
    return normalizeEmail(value);
  }

  private phone(value: string | null | undefined): string | null {
    if (value === undefined || value === null || value.trim() === '') return null;
    const p = normalizePhone(value);
    if (!p) throw fail(400, { code: 'PHONE_INVALID', message: 'Enter a phone number with 8 to 15 digits, e.g. +237 677 12 34 56.' });
    return p;
  }

  private hireDate(value: string | null | undefined): Date | null {
    if (value === undefined || value === null) return null;
    const d = parseDay(value);
    if (!d) throw fail(400, { code: 'DATE_INVALID', message: `${value} is not a real date.` });
    return d;
  }

  private numberTaken(staffNumber: string) {
    return fail(409, { code: 'STAFF_NUMBER_TAKEN', message: `Staff number ${staffNumber} is already used in your school.` });
  }

  private accountTaken() {
    return fail(409, { code: 'ACCOUNT_ALREADY_LINKED', message: 'This user account is already linked to another staff member.' });
  }

  private requireSchool(): string {
    const tenantId = currentTenantId();
    if (!tenantId) throw fail(400, { code: 'SCHOOL_REQUIRED', message: 'This action needs a school.' });
    return tenantId;
  }
}
