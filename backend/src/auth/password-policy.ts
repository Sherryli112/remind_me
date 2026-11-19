/** bcrypt 成本：註冊、修改密碼、管理員重設密碼共用 */
export const BCRYPT_COST = 12;

// 密碼規則：跟 RegisterDto / ChangePasswordDto 的 class-validator 規則一致。
// bcrypt 只看前 72 bytes，超過的部分會被忽略，所以同時限制字元數與 UTF-8 位元組數。
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;
export const PASSWORD_MAX_BYTES = 72;

/** 不符合規則時回傳錯誤訊息，符合時回傳 null。給不經過 ValidationPipe 的地方（管理員 CLI）使用。 */
export function validateNewPassword(password: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH || length > PASSWORD_MAX_LENGTH) {
    return `密碼需為 ${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} 個字元`;
  }
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return `密碼以 UTF-8 計算不可超過 ${PASSWORD_MAX_BYTES} bytes`;
  }
  return null;
}
