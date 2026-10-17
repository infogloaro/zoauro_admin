/* eslint-disable @typescript-eslint/no-require-imports, no-undef */
// Stray debug script kept for local DB inspection — not part of the build.
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  console.log('Restaurants:');
  const rest = await prisma.restaurant.findMany({ take: 3 });
  console.log(JSON.stringify(rest, null, 2));
  console.log('\nHomemakers:');
  const hom = await prisma.homemaker.findMany({ take: 3 });
  console.log(JSON.stringify(hom, null, 2));
  console.log('\nHotels:');
  const hot = await prisma.hotel.findMany({ take: 3 });
  console.log(JSON.stringify(hot, null, 2));
  console.log('\nMenu items:');
  const men = await prisma.menuItem.findMany({ take: 5 });
  console.log(JSON.stringify(men, null, 2));
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
