import NextAuth from 'next-auth';
import { authOptions } from '@/auth';

// For App Router in Next.js 15 with NextAuth v4
const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
