/* eslint-disable */
module.exports = {
  displayName: 'api',
  testEnvironment: 'node',
  rootDir: __dirname,
  testMatch: ['<rootDir>/src/**/*.spec.ts'],
  transform: {
    '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    '^@multizoo/interfaces$': '<rootDir>/../../libs/shared/interfaces/src/index.ts',
    '^@multizoo/types$': '<rootDir>/../../libs/shared/types/src/index.ts',
    '^@multizoo/utils$': '<rootDir>/../../libs/shared/utils/src/index.ts',
  },
  coverageDirectory: '../../coverage/apps/api',
};
