import { customAlphabet } from 'nanoid'

const nano = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 16)
const inviteNano = customAlphabet('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 8)

export const newId = (prefix = '') => `${prefix}${nano()}`
export const newInviteCode = () => inviteNano()
