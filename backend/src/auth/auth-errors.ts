import { HttpException, HttpStatus } from '@nestjs/common';

// 沿用專案既有 `{ code, message }` 的錯誤 body 慣例（參考 SHORT_MONTH_CONFIRMATION_REQUIRED）

export const emailTaken = () =>
  new HttpException(
    { code: 'EMAIL_TAKEN', message: '此 Email 已被註冊' },
    HttpStatus.CONFLICT,
  );

export const invalidCredentials = () =>
  new HttpException(
    { code: 'INVALID_CREDENTIALS', message: 'Email 或密碼錯誤' },
    HttpStatus.UNAUTHORIZED,
  );

export const invalidRefreshToken = () =>
  new HttpException(
    { code: 'INVALID_REFRESH_TOKEN', message: '登入狀態已失效，請重新登入' },
    HttpStatus.UNAUTHORIZED,
  );

export const unauthorized = () =>
  new HttpException(
    { code: 'UNAUTHORIZED', message: '未登入或登入已過期' },
    HttpStatus.UNAUTHORIZED,
  );
