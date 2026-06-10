import { execSync } from 'node:child_process';

export default function globalSetup(): void {
  console.log('[global-setup] Building dist before running e2e tests...');
  execSync('npm run build', { stdio: 'inherit' });
}
