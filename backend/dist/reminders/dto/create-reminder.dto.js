"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CreateReminderDto = exports.RecurrenceRuleInputDto = void 0;
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const class_transformer_1 = require("class-transformer");
const enums_1 = require("../../common/enums");
class RecurrenceRuleInputDto {
    ruleMode;
    monthDay;
    weekDay;
    timeOfDay;
}
exports.RecurrenceRuleInputDto = RecurrenceRuleInputDto;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: enums_1.RuleMode }),
    (0, class_validator_1.IsEnum)(enums_1.RuleMode),
    __metadata("design:type", String)
], RecurrenceRuleInputDto.prototype, "ruleMode", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ minimum: 1, maximum: 31 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(31),
    __metadata("design:type", Number)
], RecurrenceRuleInputDto.prototype, "monthDay", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ minimum: 0, maximum: 6 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(0),
    (0, class_validator_1.Max)(6),
    __metadata("design:type", Number)
], RecurrenceRuleInputDto.prototype, "weekDay", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: '格式 HH:mm', example: '15:30' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.Length)(5, 5),
    __metadata("design:type", String)
], RecurrenceRuleInputDto.prototype, "timeOfDay", void 0);
class CreateReminderDto {
    title;
    content;
    scheduleType;
    oneTimeAt;
    enabled;
    autoCloseEnabled;
    autoCloseSeconds;
    snoozeDefaultSeconds;
    endAt;
    maxOccurrences;
    recurrenceRules;
    skipShortMonthConfirmation;
}
exports.CreateReminderDto = CreateReminderDto;
__decorate([
    (0, swagger_1.ApiProperty)({ maxLength: 120 }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.IsNotEmpty)(),
    (0, class_validator_1.Length)(1, 120),
    __metadata("design:type", String)
], CreateReminderDto.prototype, "title", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    __metadata("design:type", String)
], CreateReminderDto.prototype, "content", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ enum: enums_1.ScheduleType }),
    (0, class_validator_1.IsEnum)(enums_1.ScheduleType),
    __metadata("design:type", String)
], CreateReminderDto.prototype, "scheduleType", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: 'scheduleType 為 one_time 時必填' }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateReminderDto.prototype, "oneTimeAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: true }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateReminderDto.prototype, "enabled", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ default: false }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateReminderDto.prototype, "autoCloseEnabled", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ minimum: 1, maximum: 600, default: 60 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    (0, class_validator_1.Max)(600),
    __metadata("design:type", Number)
], CreateReminderDto.prototype, "autoCloseSeconds", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ minimum: 60, maximum: 600, default: 300 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(60),
    (0, class_validator_1.Max)(600),
    __metadata("design:type", Number)
], CreateReminderDto.prototype, "snoozeDefaultSeconds", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)(),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsDateString)(),
    __metadata("design:type", String)
], CreateReminderDto.prototype, "endAt", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ minimum: 1 }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsInt)(),
    (0, class_validator_1.Min)(1),
    __metadata("design:type", Number)
], CreateReminderDto.prototype, "maxOccurrences", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ type: [RecurrenceRuleInputDto] }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMaxSize)(3),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => RecurrenceRuleInputDto),
    __metadata("design:type", Array)
], CreateReminderDto.prototype, "recurrenceRules", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({
        description: '每月 29~31 號需帶 true 才可儲存',
        default: false,
    }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsBoolean)(),
    __metadata("design:type", Boolean)
], CreateReminderDto.prototype, "skipShortMonthConfirmation", void 0);
//# sourceMappingURL=create-reminder.dto.js.map