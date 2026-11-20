import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Demo@1234';

async function user(data: { name: string; email: string; phone: string; role: string; status?: string; address?: string }) {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  return prisma.user.upsert({
    where: { email: data.email },
    update: {},
    create: { ...data, status: data.status ?? 'ACTIVE', passwordHash },
  });
}

async function main() {
  await prisma.user.updateMany({ where: { role: 'FARMER', status: { in: ['PENDING', 'REJECTED'] } }, data: { status: 'ACTIVE' } });
  await prisma.farmerProfile.updateMany({
    where: { verification: { in: ['PENDING', 'REJECTED'] } },
    data: { verification: 'APPROVED', verifiedAt: new Date(), rejectionReason: null },
  });

  await user({ name: 'Platform Admin', email: 'admin@farmdirect.test', phone: '9000000001', role: 'ADMIN' });

  const farmer1 = await user({ name: 'Harpreet Singh', email: 'harpreet@farmdirect.test', phone: '9000000011', role: 'FARMER' });
  const farmer2 = await user({ name: 'Meena Devi', email: 'meena@farmdirect.test', phone: '9000000012', role: 'FARMER' });
  const farmer3 = await user({ name: 'Ravi Kumar', email: 'ravi@farmdirect.test', phone: '9000000013', role: 'FARMER' });
  await prisma.farmerProfile.upsert({
    where: { userId: farmer1.id },
    update: {},
    create: { userId: farmer1.id, farmName: 'Singh Family Farm', farmLocation: 'Village Rajpura, Patiala, Punjab', bio: 'Third-generation grower of seasonal vegetables.', verification: 'APPROVED', verifiedAt: new Date() },
  });
  await prisma.farmerProfile.upsert({
    where: { userId: farmer2.id },
    update: {},
    create: { userId: farmer2.id, farmName: 'Meena Organic Orchard', farmLocation: 'Nabha Road, Patiala, Punjab', bio: 'Chemical-free fruit and honey.', verification: 'APPROVED', verifiedAt: new Date() },
  });
  await prisma.farmerProfile.upsert({
    where: { userId: farmer3.id },
    update: {},
    create: { userId: farmer3.id, farmName: 'Kumar Greens', farmLocation: 'Samana, Patiala, Punjab', verification: 'APPROVED', verifiedAt: new Date() },
  });

  await user({ name: 'Asha Verma', email: 'asha@farmdirect.test', phone: '9000000021', role: 'CONSUMER', address: '12, Model Town, Patiala, Punjab 147001' });
  await user({ name: 'Dev Courier', email: 'dev@farmdirect.test', phone: '9000000031', role: 'DELIVERY' });
  await user({ name: 'Sunil Courier', email: 'sunil@farmdirect.test', phone: '9000000032', role: 'DELIVERY' });

  const cats = ['Vegetables', 'Fruits', 'Grains & Pulses', 'Dairy', 'Honey & Preserves'];
  const cat: Record<string, string> = {};
  for (const name of cats) cat[name] = (await prisma.category.upsert({ where: { name }, update: {}, create: { name } })).id;

  if ((await prisma.product.count()) === 0) {
    const p = (farmerId: string, categoryId: string, name: string, description: string, rupees: number, unit: string, stock: number) =>
      prisma.product.create({ data: { farmerId, categoryId, name, description, price: rupees * 100, unit, stock } });
    await p(farmer1.id, cat['Vegetables'], 'Fresh Tomatoes', 'Vine-ripened, picked this morning.', 40, 'kg', 60);
    await p(farmer1.id, cat['Vegetables'], 'Spinach Bunch', 'Tender leaves, no pesticides.', 15, 'bunch', 40);
    await p(farmer1.id, cat['Vegetables'], 'Potatoes', 'Good for storing and frying.', 25, 'kg', 120);
    await p(farmer1.id, cat['Grains & Pulses'], 'Whole Wheat Atta', 'Stone-ground, 5 kg pack.', 260, 'pack', 30);
    await p(farmer2.id, cat['Fruits'], 'Kinnow Oranges', 'Sweet and juicy, direct from the orchard.', 70, 'kg', 50);
    await p(farmer2.id, cat['Fruits'], 'Guavas', 'Crunchy, ripe guavas.', 60, 'kg', 35);
    await p(farmer2.id, cat['Honey & Preserves'], 'Wild Flower Honey', 'Raw and unfiltered, 500 g jar.', 350, 'jar', 20);
    await p(farmer2.id, cat['Dairy'], 'Desi Ghee', 'Bilona method, 500 ml.', 600, 'jar', 12);
  }

  await prisma.setting.upsert({ where: { key: 'deliveryFee' }, update: {}, create: { key: 'deliveryFee', value: '4000' } });

  console.log('\nSeeded. Demo logins (password for all: ' + DEMO_PASSWORD + '):');
  console.log('  admin     admin@farmdirect.test');
  console.log('  farmer    harpreet@farmdirect.test  /  meena@farmdirect.test  /  ravi@farmdirect.test');
  console.log('  consumer  asha@farmdirect.test');
  console.log('  delivery  dev@farmdirect.test  /  sunil@farmdirect.test\n');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
