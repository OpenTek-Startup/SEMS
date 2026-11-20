/**
 * Development helper: give an account a new password when nobody knows it
 * (e.g. the seed's generated password was not saved).
 *
 *   pnpm db:set-password <email> <new-password> [school-code]
 *
 *   pnpm db:set-password superadmin@yese.local Yese2026!
 *   pnpm db:set-password admin@northfield.school Northfield2026 northfield
 *
 * Without a school code it looks for a platform account (the Super Admin).
 * The account is re-enabled, must still choose its own password at the next
 * sign-in, and all its sessions are signed out. Uses the database in .env.
 */
import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { normalizeEmail, passwordProblems } from '../src/core/auth/auth-rules';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const [emailArg, password, slug] = process.argv.slice(2);
  if (!emailArg || !password) {
    console.error('Usage: pnpm db:set-password <email> <new-password> [school-code]');
    process.exitCode = 1;
    return;
  }
  const email = normalizeEmail(emailArg);

  const problems = passwordProblems(password, { email });
  if (problems.length > 0) {
    console.error(`That password is not accepted: ${problems.join(' ')}`);
    process.exitCode = 1;
    return;
  }

  let tenantId: string | null = null;
  if (slug) {
    const tenant = await prisma.tenant.findUnique({ where: { slug: slug.toLowerCase() }, select: { id: true } });
    if (!tenant) {
      const schools = await prisma.tenant.findMany({ select: { slug: true }, orderBy: { slug: 'asc' } });
      console.error(`No school "${slug}". Schools: ${schools.map((s) => s.slug).join(', ') || 'none'}.`);
      process.exitCode = 1;
      return;
    }
    tenantId = tenant.id;
  }

  const user = await prisma.user.findFirst({ where: { tenantId, email }, select: { id: true } });
  if (!user) {
    const accounts = await prisma.user.findMany({ where: { tenantId }, select: { email: true }, orderBy: { email: 'asc' } });
    const where = slug ? `school "${slug}"` : 'the platform (no school)';
    console.error(`No account ${email} in ${where}. Accounts there: ${accounts.map((a) => a.email).join(', ') || 'none'}.`);
    if (!slug) console.error('School accounts need the school code as a third argument, e.g. northfield.');
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(password), mustChangePassword: true, status: 'active' },
  });
  await prisma.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date(), revokedReason: 'password_reset' },
  });

  console.log(`Password set for ${email}${slug ? ` (${slug})` : ' (platform)'}.`);
  console.log('Sign in with it; you will then be asked to choose your own password.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
