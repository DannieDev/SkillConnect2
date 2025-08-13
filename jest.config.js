/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.(ts|tsx|js)'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    // 👇 Redirige los módulos pesados a nuestros mocks
    '^next/server$': '<rootDir>/test-setup/mocks/next-server.ts',
    '^next-auth/jwt$': '<rootDir>/test-setup/mocks/next-auth-jwt.ts',
  },
  setupFiles: ['<rootDir>/test-setup/env.ts'],
  clearMocks: true,
  transform: {
    '^.+\\.(ts|tsx)$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }]
  }
};
