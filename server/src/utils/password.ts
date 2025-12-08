import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

export const hashPassword = async (plain: string) => bcrypt.hash(plain, SALT_ROUNDS)

export const comparePassword = async (plain: string, hash: string) => bcrypt.compare(plain, hash)
