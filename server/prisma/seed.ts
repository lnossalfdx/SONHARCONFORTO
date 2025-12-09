import 'dotenv/config'
import { prisma } from '../src/config/prisma.js'
import { hashPassword } from '../src/utils/password.js'

async function main() {
  await prisma.saleCounter.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, current: 0 },
  })
  const adminEmail = 'kemimarcondesblaze@gmail.com'
  const exists = await prisma.user.findUnique({ where: { email: adminEmail } })
  if (exists) {
    console.log('Admin já existe. Nada a fazer.')
    return
  }
  const passwordHash = await hashPassword('Kema3030!')
  await prisma.user.create({
    data: {
      name: 'Administrador Sonhar Conforto',
      email: adminEmail,
      role: 'admin',
      passwordHash,
      phone: '(11) 90000-0000',
    },
  })
  console.log('Usuário admin criado: kemimarcondesblaze@gmail.com / Kema3030!')
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
