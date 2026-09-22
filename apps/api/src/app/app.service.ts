import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getHealth() {
    return { status: 'ok', module: 'identity-access', time: new Date().toISOString() };
  }
}
