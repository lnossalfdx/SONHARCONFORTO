import { prisma } from '../src/config/prisma.js';
import { hashPassword } from '../src/utils/password.js';
async function main() {
    const adminEmail = 'admin@sonharconforto.com';
    const exists = await prisma.user.findUnique({ where: { email: adminEmail } });
    if (exists) {
        console.log('Admin já existe. Nada a fazer.');
        return;
    }
    const passwordHash = await hashPassword('admin123');
    await prisma.user.create({
        data: {
            name: 'Administradora',
            email: adminEmail,
            role: 'admin',
            passwordHash,
            phone: '(11) 99999-0000',
        },
    });
    console.log('Usuário admin criado com senha padrão admin123.');
}
main()
    .catch((error) => {
    console.error(error);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
