import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { UpdateDisplaySettingDto } from './update-display-setting.dto';

describe('UpdateDisplaySettingDto', () => {
  it('accepts valid mascotIcon bell_ring', async () => {
    const dto = plainToInstance(UpdateDisplaySettingDto, { mascotIcon: 'bell_ring' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts valid mascotIcon sparkles', async () => {
    const dto = plainToInstance(UpdateDisplaySettingDto, { mascotIcon: 'sparkles' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid mascotIcon value', async () => {
    const dto = plainToInstance(UpdateDisplaySettingDto, { mascotIcon: 'invalid_value' });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'mascotIcon')).toBe(true);
  });

  it('accepts missing mascotIcon (optional)', async () => {
    const dto = plainToInstance(UpdateDisplaySettingDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });
});
